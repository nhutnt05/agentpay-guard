import "server-only";
import type { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/anchor/constants";
import type { AgentPaymentFirewallProgram } from "@/lib/anchor/program";

// On-chain reads shared by the policy routes. Every value returned is decoded from the
// chain at request time (no DB, ADR-011/012).

type BNLike = { toString(): string };

export interface DecodedPolicy {
  owner: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  policyId: number[];
  maxPerTx: BNLike;
  dailyLimit: BNLike;
  spentToday: BNLike;
  dayIndex: BNLike;
  isPaused: boolean;
  createdAt: BNLike;
  bump: number;
}

export type PolicyLookup =
  | { kind: "found"; policy: DecodedPolicy; slot: number }
  | { kind: "missing" }
  | { kind: "not_a_policy" };

/**
 * Loads and decodes an AgentPolicy. Distinguishes "no account" from "account exists but is
 * not one of our policies" (wrong owner program or wrong discriminator).
 */
export async function loadPolicy(
  connection: Pick<Connection, "getAccountInfoAndContext">,
  program: AgentPaymentFirewallProgram,
  address: PublicKey,
): Promise<PolicyLookup> {
  const { context, value: info } = await connection.getAccountInfoAndContext(address, "confirmed");
  if (!info) return { kind: "missing" };
  if (!info.owner.equals(PROGRAM_ID)) return { kind: "not_a_policy" };
  try {
    const policy = program.coder.accounts.decode<DecodedPolicy>("agentPolicy", info.data);
    return { kind: "found", policy, slot: context.slot };
  } catch {
    return { kind: "not_a_policy" };
  }
}

/** Cluster time (unix seconds) from the latest confirmed block; null if unavailable. */
export async function clusterUnixTime(
  connection: Pick<Connection, "getSlot" | "getBlockTime">,
): Promise<{ slot: number; unixTime: number | null }> {
  const slot = await connection.getSlot("confirmed");
  const unixTime = await connection.getBlockTime(slot).catch(() => null);
  return { slot, unixTime };
}
