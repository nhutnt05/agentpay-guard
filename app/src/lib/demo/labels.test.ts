import { describe, expect, it } from "vitest";
import type { FailureReason } from "@/lib/anchor/errors";
import { EVIDENCE_LABELS, evidenceLabel, REASON_LABELS, reasonLabel, STATUS_LABELS, statusLabel } from "./labels";

describe("UI labels (docs/07 §5)", () => {
  it("evidence labels never present a simulation or pre-check as on-chain", () => {
    expect(evidenceLabel("REJECTED", "ONCHAIN")).toBe("On-chain failed transaction");
    expect(evidenceLabel("REJECTED", "SIMULATION")).toBe("Simulation only — not submitted");
    expect(evidenceLabel("REJECTED", "PRECHECK")).toBe("Pre-check — not submitted");
    expect(evidenceLabel("CONFIRMED", null)).toBe("Confirmed transaction");
    expect(evidenceLabel("ERROR", null)).toBeNull();
    expect(EVIDENCE_LABELS.SIMULATION).toMatch(/not submitted/);
  });

  it("every payment status has a label and a tone", () => {
    for (const s of ["PENDING", "READY_TO_SIGN", "SUBMITTED", "CONFIRMED", "REJECTED", "FAILED"]) {
      expect(STATUS_LABELS[s as keyof typeof STATUS_LABELS], s).toBeDefined();
    }
    expect(statusLabel("CONFIRMED").tone).toBe("success");
    expect(statusLabel("REJECTED").tone).toBe("warning");
    expect(statusLabel("SOMETHING_NEW").label).toBe("SOMETHING_NEW");
  });

  it("every backend failure reason has a human label", () => {
    const reasons: FailureReason[] = [
      "POLICY_PAUSED", "UNAUTHORIZED_AGENT", "UNAUTHORIZED_OWNER", "MERCHANT_NOT_ALLOWLISTED", "INVALID_ACCOUNTS",
      "INVALID_AMOUNT", "EXCEEDS_MAX_PER_TX", "EXCEEDS_DAILY_LIMIT", "INSUFFICIENT_VAULT_BALANCE", "INVALID_REQUEST_HASH",
      "REQUEST_EXPIRED", "DUPLICATE_REQUEST", "ARITHMETIC_OVERFLOW", "INVALID_OWNER_ACTION", "INSUFFICIENT_FEE_FUNDS",
      "NOT_LANDED", "UNKNOWN_ERROR",
    ];
    for (const r of reasons) expect(REASON_LABELS[r], r).toBeDefined();
    expect(reasonLabel(null)).toBeNull();
  });
});
