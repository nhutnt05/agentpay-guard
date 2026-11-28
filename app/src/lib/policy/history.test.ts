import { describe, expect, it } from "vitest";
import { receiptClosableAt } from "@/lib/anchor/constants";
import { closableCandidates, closedReceiptItems, type PaymentEvent } from "./history";

// F-02: closed receipts stay in the payment history (docs/16 §1.3).

const NOW = 1_800_000_000;
const OLD = NOW - (receiptClosableAt(0) + 10); // older than the close cutoff
const ev = (receipt: string): PaymentEvent => ({
  receipt,
  merchant: "M",
  agent: "A",
  amount: "1000000",
  requestHash: "ab",
  timestamp: OLD,
});

describe("payment history with closed receipts (F-02)", () => {
  it("only old, successful signatures are candidates (recent ones cannot be closed yet)", () => {
    const c = closableCandidates(
      [
        { signature: "old-ok", err: null, blockTime: OLD },
        { signature: "old-failed", err: { InstructionError: [0, { Custom: 6009 }] }, blockTime: OLD },
        { signature: "recent-ok", err: null, blockTime: NOW - 60 },
        { signature: "no-time", err: null, blockTime: null },
      ],
      NOW,
    );
    expect(c.map((s) => s.signature)).toEqual(["old-ok"]);
  });

  it("reports payments whose receipt no longer exists; skips live receipts and non-payments", async () => {
    const events: Record<string, PaymentEvent[]> = { a: [ev("closed-1")], b: [ev("live-1")], c: [] };
    const items = await closedReceiptItems(
      [
        { signature: "a", err: null, blockTime: OLD },
        { signature: "b", err: null, blockTime: OLD },
        { signature: "c", err: null, blockTime: OLD },
      ],
      new Set(["live-1"]),
      async (sig) => events[sig],
    );
    expect(items).toEqual([
      expect.objectContaining({ kind: "CLOSED_RECEIPT", status: "CONFIRMED", receiptClosed: true, receipt: "closed-1", signature: "a" }),
    ]);
  });
});
