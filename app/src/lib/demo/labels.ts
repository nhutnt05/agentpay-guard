// Human labels for statuses, evidence and reasons (docs/07 §5). The UI must never present a
// simulation or pre-check as an on-chain transaction — evidence labels make that explicit.

export type OutcomeStatus =
  | "PENDING"
  | "READY_TO_SIGN"
  | "SUBMITTED"
  | "CONFIRMED"
  | "REJECTED"
  | "FAILED"
  | "ERROR"
  | "NEEDS_OWNER_ACTION";

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";

export const STATUS_LABELS: Record<OutcomeStatus, { label: string; tone: Tone }> = {
  PENDING: { label: "Pending", tone: "neutral" },
  READY_TO_SIGN: { label: "Ready — simulation passed", tone: "info" },
  SUBMITTED: { label: "Submitted — awaiting confirmation", tone: "info" },
  CONFIRMED: { label: "Confirmed on-chain", tone: "success" },
  REJECTED: { label: "Rejected by the on-chain policy", tone: "warning" },
  FAILED: { label: "Failed", tone: "danger" },
  ERROR: { label: "Request error", tone: "danger" },
  NEEDS_OWNER_ACTION: { label: "Owner action required", tone: "neutral" },
};

export const EVIDENCE_LABELS: Record<string, string> = {
  ONCHAIN: "On-chain failed transaction",
  SIMULATION: "Simulation only — not submitted",
  PRECHECK: "Pre-check — not submitted",
  CONFIRMED_TX: "Confirmed transaction",
};

export const REASON_LABELS: Record<string, string> = {
  POLICY_PAUSED: "Policy is paused",
  UNAUTHORIZED_AGENT: "Signer is not the policy agent",
  UNAUTHORIZED_OWNER: "Signer is not the policy owner",
  MERCHANT_NOT_ALLOWLISTED: "Merchant is not on the allowlist",
  INVALID_ACCOUNTS: "Invalid accounts",
  INVALID_AMOUNT: "Invalid amount",
  EXCEEDS_MAX_PER_TX: "Exceeds the per-transaction limit",
  EXCEEDS_DAILY_LIMIT: "Exceeds the daily limit",
  EXCEEDS_ROLLING_LIMIT: "Exceeds the rolling 24-hour limit",
  EXCEEDS_MERCHANT_LIMIT: "Exceeds this merchant's limit",
  INSUFFICIENT_VAULT_BALANCE: "Vault balance is insufficient",
  UNSUPPORTED_MINT: "Token-2022 mint changed: transfer hook set or transfer fee raised",
  INVALID_REQUEST_HASH: "Request hash does not match",
  REQUEST_EXPIRED: "Request expired",
  DUPLICATE_REQUEST: "Duplicate request (already executed)",
  ARITHMETIC_OVERFLOW: "Arithmetic overflow",
  INVALID_OWNER_ACTION: "Invalid owner action",
  INSUFFICIENT_FEE_FUNDS: "Agent lacks SOL for fees",
  NOT_LANDED: "Transaction did not land (safe to retry)",
  UNKNOWN_ERROR: "Unknown error",
  POLICY_NOT_SERVED: "This server's agent does not act for this policy",
  DEMO_DISABLED: "Demo mode is disabled on the server",
};

export function statusLabel(status: string): { label: string; tone: Tone } {
  return STATUS_LABELS[status as OutcomeStatus] ?? { label: status, tone: "neutral" };
}

/** Evidence label; CONFIRMED results are labeled as confirmed transactions. */
export function evidenceLabel(status: string, evidence: string | null | undefined): string | null {
  if (status === "CONFIRMED") return EVIDENCE_LABELS.CONFIRMED_TX;
  return evidence ? (EVIDENCE_LABELS[evidence] ?? evidence) : null;
}

export function reasonLabel(reason: string | null | undefined): string | null {
  return reason ? (REASON_LABELS[reason] ?? reason) : null;
}
