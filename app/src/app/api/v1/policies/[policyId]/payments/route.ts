import { PublicKey } from "@solana/web3.js";
import { connection as requestTime } from "next/server";
import { z } from "zod";
import { mapTransactionError } from "@/lib/anchor/errors";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { fail, ok } from "@/lib/api/response";
import { bytesToHex } from "@/lib/encoding/hex";
import { closableCandidates, closedReceiptItems, type PaymentEvent } from "@/lib/policy/history";
import { loadPolicy } from "@/lib/policy/read";
import { rateLimitRead } from "@/lib/server/guards";
import { getServerConnection } from "@/lib/solana/connection";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/solana/explorer";
import { PolicyRouteParamsSchema } from "@/lib/validation/common";

// GET /api/v1/policies/[policyId]/payments?limit=20 (docs/06 §3.8). Two on-chain sources:
//  - successful payments = PaymentReceipt accounts (getProgramAccounts, policy @ offset 8)
//  - rejected attempts   = failed transactions referencing the policy (getSignaturesForAddress)
//  - closed receipts (F-02) = successful txs old enough to be closable whose PaymentExecuted
//    receipt no longer exists (decoded from the tx logs; `receiptClosed: true`)
// Bounded by `limit` to protect RPC quota. Receipts do not store their signature.

const QuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) });

export async function GET(request: Request, ctx: RouteContext<"/api/v1/policies/[policyId]/payments">) {
  await requestTime();
  const limited = rateLimitRead(request, "payments");
  if (limited) return limited;

  const parsed = PolicyRouteParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "invalid policy address", parsed.error.issues);
  const query = QuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return fail(400, "VALIDATION_ERROR", "invalid query", query.error.issues);
  const policy = new PublicKey(parsed.data.policyId);
  const { limit } = query.data;

  const connection = getServerConnection();
  const program = getReadonlyProgram(connection, PublicKey.default);
  try {
    const lookup = await loadPolicy(connection, program, policy);
    if (lookup.kind === "missing") return fail(404, "NOT_FOUND", "no account at this address");
    if (lookup.kind === "not_a_policy") return fail(404, "NOT_A_POLICY", "account is not an AgentPay Guard policy");

    const [receipts, signatures] = await Promise.all([
      program.account.paymentReceipt.all([{ memcmp: { offset: 8, bytes: policy.toBase58() } }]),
      connection.getSignaturesForAddress(policy, { limit }, "confirmed"),
    ]);

    const receiptItems = receipts.map((r) => ({
      kind: "RECEIPT" as const,
      status: "CONFIRMED" as const,
      receipt: r.publicKey.toBase58(),
      explorerUrl: explorerAddressUrl(r.publicKey.toBase58()),
      merchant: r.account.merchant.toBase58(),
      agent: r.account.agent.toBase58(),
      amount: r.account.amount.toString(),
      requestHash: bytesToHex(Uint8Array.from(r.account.requestHash)),
      timestamp: Number(r.account.createdAt.toString()),
    }));

    // F-02: payments whose receipt was closed are still history (decoded from their event).
    const live = new Set(receiptItems.map((r) => r.receipt));
    const nowSeconds = (await connection.getBlockTime(await connection.getSlot("confirmed"))) ?? Math.floor(Date.now() / 1000);
    const eventsOf = async (signature: string): Promise<PaymentEvent[]> => {
      const tx = await connection
        .getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
        .catch(() => null);
      const events: PaymentEvent[] = [];
      for (const line of tx?.meta?.logMessages ?? []) {
        if (!line.startsWith("Program data: ")) continue;
        const ev = program.coder.events.decode(line.slice("Program data: ".length));
        if (!ev || ev.name.toLowerCase() !== "paymentexecuted") continue;
        const d = ev.data as Record<string, { toString(): string } | number[]>;
        if (d.policy.toString() !== policy.toBase58()) continue;
        events.push({
          receipt: d.receipt.toString(),
          merchant: d.merchant.toString(),
          agent: d.agent.toString(),
          amount: d.amount.toString(),
          requestHash: bytesToHex(Uint8Array.from(d.requestHash as number[])),
          timestamp: Number(d.timestamp.toString()),
        });
      }
      return events;
    };
    const closedItems = (await closedReceiptItems(closableCandidates(signatures, nowSeconds), live, eventsOf)).map((c) => ({
      ...c,
      explorerUrl: explorerTxUrl(c.signature),
    }));

    const failed = signatures.filter((s) => s.err !== null);
    const failedItems = await Promise.all(
      failed.map(async (s) => {
        const tx = await connection
          .getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" })
          .catch(() => null);
        const mapped = mapTransactionError(s.err, tx?.meta?.logMessages ?? null);
        return {
          kind: "FAILED_TX" as const,
          status: mapped.status,
          evidence: "ONCHAIN" as const,
          reason: mapped.reason,
          programError: mapped.code === null ? null : { code: mapped.code, name: mapped.name },
          signature: s.signature,
          explorerUrl: explorerTxUrl(s.signature),
          timestamp: s.blockTime ?? null,
          slot: s.slot,
        };
      }),
    );

    const items = [...receiptItems, ...closedItems, ...failedItems]
      .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
      .slice(0, limit);

    return ok({
      policy: policy.toBase58(),
      limit,
      receiptCount: receiptItems.length,
      closedReceiptCount: closedItems.length,
      rejectedCount: failedItems.length,
      items,
    });
  } catch {
    return fail(502, "RPC_ERROR", "failed to read payments from the cluster");
  }
}
