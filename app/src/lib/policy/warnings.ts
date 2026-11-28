// Owner-facing configuration warnings (T-M4-17, docs/05 §7). The program blocks allowlisting
// the CURRENT agent as a merchant (`add_merchant` → InvalidMerchant), but `update_policy` can
// still make an already-allowlisted merchant the new agent. Then the agent can pay itself,
// bypassing the point of the allowlist. The program allows it (owner's choice); the UI warns.

export const AGENT_IS_MERCHANT_WARNING =
  "The agent is also an allowlisted merchant: the agent can pay itself. Remove that merchant or choose a different agent.";

/** True when `agent` (base58) is one of the allowlisted merchant wallets. */
export function agentIsAllowlistedMerchant(agent: string, allowlistedMerchants: readonly string[]): boolean {
  return allowlistedMerchants.includes(agent);
}

/**
 * Check for the "replace agent" form (T-M4-08): warn BEFORE the owner signs an update that
 * would make an allowlisted merchant the agent. Returns the warning text or null.
 */
export function newAgentWarning(newAgent: string, allowlistedMerchants: readonly string[]): string | null {
  return agentIsAllowlistedMerchant(newAgent.trim(), allowlistedMerchants) ? AGENT_IS_MERCHANT_WARNING : null;
}
