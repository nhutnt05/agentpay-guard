import { MAX_REQUEST_TTL_SECONDS, RECEIPT_CLOSE_GRACE_SECONDS } from "@/lib/anchor/constants";

// F-02 history: once a receipt is closed (docs/16 §1.3) it disappears from getProgramAccounts,
// but the payment still happened. Its record lives in the transaction's `PaymentExecuted` event.
// Only successful transactions older than the earliest possible close time can belong to a closed
// receipt, so newer ones are not fetched (saves RPC calls).

export interface PaymentEvent {
  receipt: string;
  merchant: string;
  agent: string;
  amount: string;
  requestHash: string;
  timestamp: number;
}

export interface ClosedReceiptItem extends PaymentEvent {
  kind: "CLOSED_RECEIPT";
  status: "CONFIRMED";
  receiptClosed: true;
  signature: string;
}

export interface SignatureInfo {
  signature: string;
  err: unknown;
  blockTime?: number | null;
}

/** Successful signatures old enough that their receipt may have been closed. */
export function closableCandidates(signatures: readonly SignatureInfo[], nowSeconds: number): SignatureInfo[] {
  const cutoff = nowSeconds - MAX_REQUEST_TTL_SECONDS - RECEIPT_CLOSE_GRACE_SECONDS;
  return signatures.filter((s) => s.err === null && typeof s.blockTime === "number" && s.blockTime <= cutoff);
}

/**
 * Payments whose receipt account no longer exists. `eventsOf` returns the decoded
 * PaymentExecuted events of a transaction (empty for non-payment transactions).
 */
export async function closedReceiptItems(
  candidates: readonly SignatureInfo[],
  liveReceipts: ReadonlySet<string>,
  eventsOf: (signature: string) => Promise<PaymentEvent[]>,
): Promise<ClosedReceiptItem[]> {
  const out: ClosedReceiptItem[] = [];
  for (const s of candidates) {
    for (const ev of await eventsOf(s.signature)) {
      if (liveReceipts.has(ev.receipt)) continue;
      out.push({ ...ev, kind: "CLOSED_RECEIPT", status: "CONFIRMED", receiptClosed: true, signature: s.signature });
    }
  }
  return out;
}
