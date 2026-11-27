import { getMint } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { connection as requestTime } from "next/server";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { fail, ok } from "@/lib/api/response";
import { bytesToHex } from "@/lib/encoding/hex";
import { dayIndex, effectiveDailySpend } from "@/lib/policy/effective";
import { clusterUnixTime, loadPolicy } from "@/lib/policy/read";
import { checkPolicyServed, getAllowedOwners } from "@/lib/server/access";
import { getAgentPublicKey } from "@/lib/server/agentKeypair";
import { rateLimitRead } from "@/lib/server/guards";
import { getServerConnection } from "@/lib/solana/connection";
import { PolicyRouteParamsSchema } from "@/lib/validation/common";

// GET /api/v1/policies/[policyId] (docs/06 §3.7). `policyId` is the policy PDA ADDRESS.
// Stored values come straight from the account; `effective*` values are DERIVED from the
// stored counter and cluster time (docs/11 §5) and labeled as such.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/policies/[policyId]">) {
  await requestTime();
  const limited = rateLimitRead(request, "policy");
  if (limited) return limited;

  const parsed = PolicyRouteParamsSchema.safeParse(await ctx.params);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "invalid policy address", parsed.error.issues);
  const address = new PublicKey(parsed.data.policyId);

  const connection = getServerConnection();
  const program = getReadonlyProgram(connection, PublicKey.default);
  try {
    const lookup = await loadPolicy(connection, program, address);
    if (lookup.kind === "missing") return fail(404, "NOT_FOUND", "no account at this address");
    if (lookup.kind === "not_a_policy") return fail(404, "NOT_A_POLICY", "account is not an AgentPay Guard policy");
    const p = lookup.policy;

    const [mint, vaultBalance, clock] = await Promise.all([
      getMint(connection, p.mint, "confirmed"),
      connection
        .getTokenAccountBalance(p.vault, "confirmed")
        .then((b) => b.value.amount)
        .catch(() => null),
      clusterUnixTime(connection),
    ]);

    const currentDay = clock.unixTime === null ? null : dayIndex(clock.unixTime);
    const daily =
      currentDay === null
        ? null
        : effectiveDailySpend({
            spentToday: BigInt(p.spentToday.toString()),
            storedDayIndex: Number(p.dayIndex.toString()),
            currentDayIndex: currentDay,
            dailyLimit: BigInt(p.dailyLimit.toString()),
          });

    const access = (() => {
      try {
        return checkPolicyServed(p, getAgentPublicKey(), getAllowedOwners());
      } catch {
        return { allowed: false as const, reason: "ALLOWLIST_NOT_CONFIGURED" as const };
      }
    })();

    return ok({
      address: address.toBase58(),
      owner: p.owner.toBase58(),
      agent: p.agent.toBase58(),
      mint: p.mint.toBase58(),
      decimals: mint.decimals,
      vault: p.vault.toBase58(),
      policyIdHex: bytesToHex(Uint8Array.from(p.policyId)),
      maxPerTx: p.maxPerTx.toString(),
      dailyLimit: p.dailyLimit.toString(),
      spentTodayStored: p.spentToday.toString(),
      dayIndexStored: Number(p.dayIndex.toString()),
      isPaused: p.isPaused,
      createdAt: Number(p.createdAt.toString()),
      vaultBalance,
      derived: {
        currentDay,
        effectiveSpentToday: daily?.effectiveSpentToday.toString() ?? null,
        remainingToday: daily?.remainingToday.toString() ?? null,
      },
      servedByThisAgent: access.allowed,
      accessReason: access.allowed ? null : access.reason,
      readAt: { slot: lookup.slot, commitment: "confirmed" },
    });
  } catch {
    return fail(502, "RPC_ERROR", "failed to read policy from the cluster");
  }
}
