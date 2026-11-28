import {
  AgentPaymentFirewallErrorCode,
  type AgentPaymentFirewallErrorName,
} from "./idl/agent_payment_firewall_errors";

// Maps a failed simulation / transaction (`err` + program logs) to the API reason codes of
// docs/11 §7. REJECTED = the program refused by policy; FAILED = infrastructure / unknown.
// Codes come from the synced IDL error map, never hard-coded program numbers.

export type FailureStatus = "REJECTED" | "FAILED";

export type FailureReason =
  | "POLICY_PAUSED"
  | "UNAUTHORIZED_AGENT"
  | "UNAUTHORIZED_OWNER"
  | "MERCHANT_NOT_ALLOWLISTED"
  | "INVALID_ACCOUNTS"
  | "INVALID_AMOUNT"
  | "EXCEEDS_MAX_PER_TX"
  | "EXCEEDS_DAILY_LIMIT"
  | "EXCEEDS_ROLLING_LIMIT"
  | "EXCEEDS_MERCHANT_LIMIT"
  | "INSUFFICIENT_VAULT_BALANCE"
  | "UNSUPPORTED_MINT"
  | "INVALID_REQUEST_HASH"
  | "REQUEST_EXPIRED"
  | "DUPLICATE_REQUEST"
  | "ARITHMETIC_OVERFLOW"
  | "INVALID_OWNER_ACTION"
  | "INSUFFICIENT_FEE_FUNDS"
  | "NOT_LANDED"
  | "UNKNOWN_ERROR";

export interface MappedError {
  status: FailureStatus;
  reason: FailureReason;
  /** Custom error number reported by the failing instruction, if any. */
  code: number | null;
  /** Program error name (IDL) or Anchor framework error name from the logs. */
  name: string | null;
  /** Account named by Anchor's "caused by account" log line, if any. */
  account: string | null;
}

/** Every program error is mapped (exhaustive by type). */
const PROGRAM_ERROR_REASONS: Record<AgentPaymentFirewallErrorName, FailureReason> = {
  PolicyPaused: "POLICY_PAUSED",
  UnauthorizedAgent: "UNAUTHORIZED_AGENT",
  UnauthorizedOwner: "UNAUTHORIZED_OWNER",
  MerchantNotAllowed: "MERCHANT_NOT_ALLOWLISTED",
  InvalidMint: "INVALID_ACCOUNTS",
  InvalidVault: "INVALID_ACCOUNTS",
  InvalidMerchantTokenAccount: "INVALID_ACCOUNTS",
  InvalidAmount: "INVALID_AMOUNT",
  ExceedsMaxPerTx: "EXCEEDS_MAX_PER_TX",
  ExceedsDailyLimit: "EXCEEDS_DAILY_LIMIT",
  InsufficientVaultBalance: "INSUFFICIENT_VAULT_BALANCE",
  InvalidRequestHash: "INVALID_REQUEST_HASH",
  RequestExpired: "REQUEST_EXPIRED",
  RequestExpiryTooFar: "REQUEST_EXPIRED",
  ArithmeticOverflow: "ARITHMETIC_OVERFLOW",
  InvalidPolicyLimits: "INVALID_OWNER_ACTION",
  InvalidAgent: "INVALID_OWNER_ACTION",
  PolicyAlreadyPaused: "INVALID_OWNER_ACTION",
  PolicyNotPaused: "INVALID_OWNER_ACTION",
  InvalidWithdrawDestination: "INVALID_OWNER_ACTION",
  EmptyUpdate: "INVALID_OWNER_ACTION",
  InvalidMerchant: "INVALID_OWNER_ACTION",
  UnauthorizedCloser: "INVALID_OWNER_ACTION",
  InvalidRentDestination: "INVALID_OWNER_ACTION",
  ReceiptNotExpired: "INVALID_OWNER_ACTION",
  // F-05: Token-2022 transfer hook set or transfer fee raised by the issuer → policy refusal.
  UnsupportedMintExtension: "UNSUPPORTED_MINT",
  IssuerPowersNotAccepted: "INVALID_OWNER_ACTION",
  InvalidTokenProgram: "INVALID_ACCOUNTS",
  // F-03 optional rule accounts.
  ExceedsRollingLimit: "EXCEEDS_ROLLING_LIMIT",
  ExceedsMerchantMaxPerTx: "EXCEEDS_MERCHANT_LIMIT",
  ExceedsMerchantDailyLimit: "EXCEEDS_MERCHANT_LIMIT",
};

const NAME_BY_CODE = new Map<number, AgentPaymentFirewallErrorName>(
  Object.entries(AgentPaymentFirewallErrorCode).map(([name, code]) => [
    code,
    name as AgentPaymentFirewallErrorName,
  ]),
);

/** Anchor framework error: AccountNotInitialized (verified in EP-03). */
const ANCHOR_ACCOUNT_NOT_INITIALIZED = 3012;
/** Anchor framework error ranges (constraints 2000–2999, accounts 3000–3999). */
const isAnchorFrameworkCode = (code: number) => code >= 2000 && code < 5000;

// "Program log: AnchorError caused by account: merchant_allowlist. Error Code:
//  AccountNotInitialized. Error Number: 3012. Error Message: ..."   (EP-03, verbatim)
const ANCHOR_ACCOUNT_LOG = /AnchorError caused by account: (\w+)\. Error Code: (\w+)\. Error Number: (\d+)/;
// "Program log: AnchorError thrown in <file>:<line>. Error Code: X. Error Number: N." and
// "Program log: AnchorError occurred. Error Code: X. Error Number: N."
const ANCHOR_ERROR_LOG = /AnchorError[^.]*\. Error Code: (\w+)\. Error Number: (\d+)/;
// "Allocate: account Address { address: …, base: None } already in use"  (EP-14, verbatim)
const ALREADY_IN_USE_LOG = /already in use/;

/** Extracts the custom error number from a web3.js `TransactionError`, if present. */
export function customErrorCode(err: unknown): number | null {
  if (!err || typeof err !== "object" || !("InstructionError" in err)) return null;
  const ie = (err as { InstructionError: unknown }).InstructionError;
  if (!Array.isArray(ie) || ie.length !== 2) return null;
  const detail = ie[1];
  if (detail && typeof detail === "object" && "Custom" in detail) {
    const code = (detail as { Custom: unknown }).Custom;
    return typeof code === "number" ? code : null;
  }
  return null;
}

export function mapTransactionError(
  err: unknown,
  logs: readonly string[] | null | undefined,
): MappedError {
  const lines = logs ?? [];
  const code = customErrorCode(err);
  const accountMatch = lines.map((l) => ANCHOR_ACCOUNT_LOG.exec(l)).find(Boolean) ?? null;
  const errorMatch = lines.map((l) => ANCHOR_ERROR_LOG.exec(l)).find(Boolean) ?? null;
  const account = accountMatch?.[1] ?? null;
  const base = { code, account };

  // 1. Our program's custom errors (6000+), resolved through the IDL error map.
  if (code !== null && NAME_BY_CODE.has(code)) {
    const name = NAME_BY_CODE.get(code)!;
    return { ...base, status: "REJECTED", reason: PROGRAM_ERROR_REASONS[name], name };
  }

  // 2. Non-allowlisted merchant: the allowlist PDA does not exist (docs/11 §7, EP-03).
  if (code === ANCHOR_ACCOUNT_NOT_INITIALIZED && account === "merchant_allowlist") {
    return {
      ...base,
      status: "REJECTED",
      reason: "MERCHANT_NOT_ALLOWLISTED",
      name: "AccountNotInitialized",
    };
  }

  // 3. Duplicate request: receipt `init` fails inside the System Program with Custom(0)
  //    and an "already in use" log (EP-14). Code 0 alone is ambiguous, so require the log.
  if (code === 0 && lines.some((l) => ALREADY_IN_USE_LOG.test(l))) {
    return { ...base, status: "REJECTED", reason: "DUPLICATE_REQUEST", name: "AccountAlreadyInUse" };
  }

  // 4. Other Anchor constraint/account errors (wrong PDA, wrong owner, wrong program...).
  if (code !== null && isAnchorFrameworkCode(code)) {
    return {
      ...base,
      status: "REJECTED",
      reason: "INVALID_ACCOUNTS",
      name: accountMatch?.[2] ?? errorMatch?.[1] ?? null,
    };
  }

  // 5. Transaction-level failures that never reached the program.
  if (err === "InsufficientFundsForFee" || err === "InsufficientFundsForRent") {
    return { ...base, status: "FAILED", reason: "INSUFFICIENT_FEE_FUNDS", name: err };
  }
  if (err === "BlockhashNotFound") {
    return { ...base, status: "FAILED", reason: "NOT_LANDED", name: err };
  }

  return {
    ...base,
    status: "FAILED",
    reason: "UNKNOWN_ERROR",
    name: typeof err === "string" ? err : (errorMatch?.[1] ?? null),
  };
}
