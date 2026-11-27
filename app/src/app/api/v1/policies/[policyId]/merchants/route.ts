import { PublicKey } from "@solana/web3.js";
import { connection as requestTime } from "next/server";
import { merchantTokenAccount } from "@/lib/anchor/pda";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { fail, ok } from "@/lib/api/response";
import { loadPolicy } from "@/lib/policy/read";
import { rateLimitRead } from "@/lib/server/guards";
import { getServerConnection } from "@/lib/solana/connection";
import { PolicyRouteParamsSchema } from "@/lib/validation/common";

// GET /api/v1/policies/[policyId]/merchants (docs/06 §3.9): allowlist entries of a policy,
// found with getProgramAccounts (discriminator + memcmp on `policy` at offset 8).
export async function GET(request: Request, ctx: RouteContext<"/api/v1/policies/[policyId]/merchants">) {
  await requestTime();
  const limited = rateLimitRead(request, "merchants");
  if (limited) return limited;

  const parsed = PolicyRouteParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "invalid policy address", parsed.error.issues);
  const policy = new PublicKey(parsed.data.policyId);

  const connection = getServerConnection();
  const program = getReadonlyProgram(connection, PublicKey.default);
  try {
    const lookup = await loadPolicy(connection, program, policy);
    if (lookup.kind === "missing") return fail(404, "NOT_FOUND", "no account at this address");
    if (lookup.kind === "not_a_policy") return fail(404, "NOT_A_POLICY", "account is not an AgentPay Guard policy");
    const mint = lookup.policy.mint;

    const entries = await program.account.merchantAllowlist.all([
      { memcmp: { offset: 8, bytes: policy.toBase58() } },
    ]);
    const atas = entries.map((e) => merchantTokenAccount(e.account.merchant, mint));
    const ataInfos = atas.length ? await connection.getMultipleAccountsInfo(atas, "confirmed") : [];

    const merchants = entries
      .map((e, i) => ({
        address: e.publicKey.toBase58(),
        merchant: e.account.merchant.toBase58(),
        isAllowed: e.account.isAllowed,
        createdAt: Number(e.account.createdAt.toString()),
        merchantTokenAccount: atas[i].toBase58(),
        merchantAtaExists: Boolean(ataInfos[i]),
      }))
      .sort((a, b) => a.createdAt - b.createdAt);

    return ok({ policy: policy.toBase58(), mint: mint.toBase58(), count: merchants.length, merchants });
  } catch {
    return fail(502, "RPC_ERROR", "failed to read merchants from the cluster");
  }
}
