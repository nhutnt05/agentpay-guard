import "server-only";
import { PublicKey } from "@solana/web3.js";

// Which policies this server's agent may act for (docs/06 §1.1, threat T-19).
// The agent signs `execute_payment` only when BOTH hold, read from chain (never from the
// request body): policy.agent == server agent, and policy.owner ∈ ALLOWED_POLICY_OWNERS.
// An empty/missing allowlist denies everything (safe default for public deployments).

export class AccessConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessConfigError";
  }
}

/** Parses a comma-separated list of owner public keys. Invalid entries are a config error. */
export function parseAllowedOwners(raw: string | undefined): ReadonlySet<string> {
  const owners = new Set<string>();
  for (const entry of (raw ?? "").split(",")) {
    const value = entry.trim();
    if (!value) continue;
    try {
      owners.add(new PublicKey(value).toBase58());
    } catch {
      throw new AccessConfigError(`ALLOWED_POLICY_OWNERS contains an invalid public key: '${value}'`);
    }
  }
  return owners;
}

export type PolicyAccessDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason: "AGENT_NOT_CONFIGURED" | "AGENT_MISMATCH" | "ALLOWLIST_NOT_CONFIGURED" | "OWNER_NOT_ALLOWED";
    };

/** Pure decision used by payment routes (on-chain `owner`/`agent` in, decision out). */
export function checkPolicyServed(
  policy: { owner: PublicKey; agent: PublicKey },
  serverAgent: PublicKey | null,
  allowedOwners: ReadonlySet<string>,
): PolicyAccessDecision {
  if (!serverAgent) return { allowed: false, reason: "AGENT_NOT_CONFIGURED" };
  if (!policy.agent.equals(serverAgent)) return { allowed: false, reason: "AGENT_MISMATCH" };
  if (allowedOwners.size === 0) return { allowed: false, reason: "ALLOWLIST_NOT_CONFIGURED" };
  if (!allowedOwners.has(policy.owner.toBase58())) return { allowed: false, reason: "OWNER_NOT_ALLOWED" };
  return { allowed: true };
}

let cachedOwners: ReadonlySet<string> | undefined;

/** `ALLOWED_POLICY_OWNERS` from the environment (parsed once). */
export function getAllowedOwners(): ReadonlySet<string> {
  cachedOwners ??= parseAllowedOwners(process.env.ALLOWED_POLICY_OWNERS);
  return cachedOwners;
}
