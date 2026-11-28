import { describe, expect, it } from "vitest";
import { customErrorCode, mapTransactionError } from "./errors";
import idl from "./idl/agent_payment_firewall.json";

// API-02: error mapping (docs/11 §7). The log fixtures are VERBATIM output of the Rust
// LiteSVM tests EP-03 and EP-14 (2026-11-27), not hand-written strings.
const PROGRAM = "GvjcbQ2g7dg6ZNNBffhyVLmSz8ncbaEvL2c4M1Esayza";

const EP03_LOGS = [
  `Program ${PROGRAM} invoke [1]`,
  "Program log: Instruction: ExecutePayment",
  "Program log: AnchorError caused by account: merchant_allowlist. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: The program expected this account to be already initialized.",
  `Program ${PROGRAM} consumed 5254 of 200000 compute units`,
  `Program ${PROGRAM} failed: custom program error: 0xbc4`,
];

const EP14_LOGS = [
  `Program ${PROGRAM} invoke [1]`,
  "Program log: Instruction: ExecutePayment",
  "Program 11111111111111111111111111111111 invoke [2]",
  "Allocate: account Address { address: 2FnPkpiWmYiuHaK98JNysYpm8T2qBBqsgxHZLd68miK3, base: None } already in use",
  "Program 11111111111111111111111111111111 failed: custom program error: 0x0",
  `Program ${PROGRAM} consumed 8399 of 200000 compute units`,
  `Program ${PROGRAM} failed: custom program error: 0x0`,
];

const custom = (code: number, index = 0) => ({ InstructionError: [index, { Custom: code }] });

describe("mapTransactionError (API-02)", () => {
  it("non-allowlisted merchant (EP-03 logs) → MERCHANT_NOT_ALLOWLISTED", () => {
    expect(mapTransactionError(custom(3012), EP03_LOGS)).toEqual({
      status: "REJECTED",
      reason: "MERCHANT_NOT_ALLOWLISTED",
      code: 3012,
      name: "AccountNotInitialized",
      account: "merchant_allowlist",
    });
  });

  it("matches on the code, not the instruction index (e.g. compute-budget ix first)", () => {
    expect(mapTransactionError(custom(3012, 2), EP03_LOGS).reason).toBe("MERCHANT_NOT_ALLOWLISTED");
  });

  it("duplicate request (EP-14 logs: System Program Custom(0) + 'already in use') → DUPLICATE_REQUEST", () => {
    expect(mapTransactionError(custom(0), EP14_LOGS)).toMatchObject({
      status: "REJECTED",
      reason: "DUPLICATE_REQUEST",
      code: 0,
    });
  });

  it("Custom(0) without the 'already in use' log is NOT treated as a duplicate", () => {
    expect(mapTransactionError(custom(0), ["Program log: something else"])).toMatchObject({
      status: "FAILED",
      reason: "UNKNOWN_ERROR",
    });
  });

  it("AccountNotInitialized on another account is an account error, not an allowlist rejection", () => {
    const logs = [
      "Program log: AnchorError caused by account: receipt. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: x.",
    ];
    expect(mapTransactionError(custom(3012), logs)).toMatchObject({
      status: "REJECTED",
      reason: "INVALID_ACCOUNTS",
      account: "receipt",
    });
  });

  it.each([
    [6000, "POLICY_PAUSED"],
    [6001, "UNAUTHORIZED_AGENT"],
    [6002, "UNAUTHORIZED_OWNER"],
    [6003, "MERCHANT_NOT_ALLOWLISTED"],
    [6004, "INVALID_ACCOUNTS"],
    [6008, "EXCEEDS_MAX_PER_TX"],
    [6009, "EXCEEDS_DAILY_LIMIT"],
    [6010, "INSUFFICIENT_VAULT_BALANCE"],
    [6011, "INVALID_REQUEST_HASH"],
    [6012, "REQUEST_EXPIRED"],
    [6013, "REQUEST_EXPIRED"],
    [6014, "ARITHMETIC_OVERFLOW"],
    [6024, "INVALID_OWNER_ACTION"], // F-02 ReceiptNotExpired
    [6025, "UNSUPPORTED_MINT"], // F-05 UnsupportedMintExtension
    [6027, "INVALID_ACCOUNTS"], // F-05 InvalidTokenProgram
    [6028, "EXCEEDS_ROLLING_LIMIT"], // F-03
    [6029, "EXCEEDS_MERCHANT_LIMIT"], // F-03
    [6030, "EXCEEDS_MERCHANT_LIMIT"], // F-03
  ])("program error %i → %s", (code, reason) => {
    expect(mapTransactionError(custom(code), [])).toMatchObject({ status: "REJECTED", reason, code });
  });

  it("every program error in the IDL maps to a REJECTED reason with its IDL name", () => {
    for (const e of idl.errors) {
      const mapped = mapTransactionError(custom(e.code), []);
      expect(mapped.status).toBe("REJECTED");
      expect(mapped.name).toBe(e.name);
      expect(mapped.reason).not.toBe("UNKNOWN_ERROR");
    }
  });

  it("Anchor framework constraint errors (e.g. ConstraintSeeds 2006) → INVALID_ACCOUNTS", () => {
    expect(mapTransactionError(custom(2006), [])).toMatchObject({
      status: "REJECTED",
      reason: "INVALID_ACCOUNTS",
    });
  });

  it("transaction-level failures are FAILED, not REJECTED", () => {
    expect(mapTransactionError("InsufficientFundsForFee", null).reason).toBe("INSUFFICIENT_FEE_FUNDS");
    expect(mapTransactionError("BlockhashNotFound", null).reason).toBe("NOT_LANDED");
    expect(mapTransactionError({ Weird: 1 }, null)).toMatchObject({ status: "FAILED", reason: "UNKNOWN_ERROR" });
  });

  it("customErrorCode handles malformed inputs", () => {
    expect(customErrorCode(null)).toBeNull();
    expect(customErrorCode("AccountInUse")).toBeNull();
    expect(customErrorCode({ InstructionError: [0, "InvalidArgument"] })).toBeNull();
    expect(customErrorCode(custom(6009))).toBe(6009);
  });
});
