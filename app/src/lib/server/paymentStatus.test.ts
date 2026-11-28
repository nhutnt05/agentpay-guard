import { BN } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { PROGRAM_ID, receiptClosableAt } from "@/lib/anchor/constants";
import idl from "@/lib/anchor/idl/agent_payment_firewall.json";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { getPaymentStatus, type PaymentDeps, type PaymentRpc } from "./payments";

// GET /payments/[signature] status rules, incl. F-02 closed receipts. The PaymentExecuted
// event in the logs is encoded with the real Anchor coder from the synced IDL.

const agent = Keypair.generate();
const program = getReadonlyProgram(new Connection("http://127.0.0.1:1"), agent.publicKey);
const SIGNATURE = "5uCXVGHUYpCgPBW4qJfyKsaUGov3E12avRn6YzBFQa7CTGPnV1fEAAUgfisvBjHvDQzC31Gdrn6sChPFGSz3Jih8";
const EXECUTED_AT = 1_800_000_000;
const receipt = Keypair.generate().publicKey;

async function paymentExecutedLog(): Promise<string> {
  const ev = idl.events.find((e) => e.name === "PaymentExecuted")!;
  const body = await program.coder.types.encode("paymentExecuted", {
    policy: Keypair.generate().publicKey,
    receipt,
    requestHash: Array(32).fill(1),
    agent: agent.publicKey,
    merchant: Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
    amount: new BN(2_000_000),
    spentToday: new BN(2_000_000),
    dayIndex: new BN(Math.floor(EXECUTED_AT / 86_400)),
    timestamp: new BN(EXECUTED_AT),
  });
  return "Program data: " + Buffer.concat([Buffer.from(ev.discriminator), body]).toString("base64");
}

async function status(o: { receiptExists: boolean; now: number }) {
  const logs = [await paymentExecutedLog()];
  const rpc = {
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "finalized", err: null, slot: 5 }] }),
    getTransaction: async () => ({
      blockTime: EXECUTED_AT,
      transaction: { message: { staticAccountKeys: [agent.publicKey, PROGRAM_ID] } },
      meta: { err: null, logMessages: logs },
    }),
    getAccountInfo: async (addr: PublicKey) =>
      o.receiptExists && addr.equals(receipt)
        ? { owner: PROGRAM_ID, data: Buffer.alloc(185), lamports: 1, executable: false }
        : null,
    getSlot: async () => 10,
    getBlockTime: async () => o.now,
  } as unknown as PaymentRpc;
  const deps: PaymentDeps = {
    rpc,
    program,
    agent,
    allowedOwners: new Set(),
    demoMode: false,
    confirmTimeoutMs: 1_000,
  };
  return getPaymentStatus(deps, SIGNATURE);
}

describe("payment status and closed receipts (F-02)", () => {
  it("receipt present → CONFIRMED, receiptClosed false, createdAt from the event", async () => {
    const r = await status({ receiptExists: true, now: EXECUTED_AT + 60 });
    expect(r.status).toBe("CONFIRMED");
    expect(r.payment).toMatchObject({ amount: "2000000", createdAt: EXECUTED_AT, receiptClosed: false });
  });

  it("receipt missing after the grace period → CONFIRMED with receiptClosed", async () => {
    const r = await status({ receiptExists: false, now: receiptClosableAt(EXECUTED_AT) });
    expect(r.status).toBe("CONFIRMED");
    expect(r.error).toBeNull();
    expect(r.payment?.receiptClosed).toBe(true);
  });

  it("receipt missing before the grace period → FAILED ReceiptMissing (anomaly)", async () => {
    const r = await status({ receiptExists: false, now: receiptClosableAt(EXECUTED_AT) - 1 });
    expect(r.status).toBe("FAILED");
    expect(r.error?.name).toBe("ReceiptMissing");
  });
});
