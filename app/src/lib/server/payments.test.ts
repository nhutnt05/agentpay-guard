import { BN } from "@anchor-lang/core";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROGRAM_ID } from "@/lib/anchor/constants";
import { policyPda, receiptPda } from "@/lib/anchor/pda";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { hexToBytes } from "@/lib/encoding/hex";
import { PrepareRequestSchema, SubmitRequestSchema } from "@/lib/validation/payments";
import {
  type PaymentDeps,
  type PaymentRpc,
  PaymentServiceError,
  preparePayment,
  submitPayment,
} from "./payments";

// API-03…API-05 and the prepare/submit/status contract, against a fake RPC. The policy
// account the fake serves is encoded by the real Anchor coder from the synced IDL.

const NOW = 1_800_000_000;
const owner = Keypair.generate().publicKey;
const agent = Keypair.generate();
const mint = Keypair.generate().publicKey;
const merchant = Keypair.generate().publicKey;
const [policy] = policyPda(owner, new Uint8Array(32).fill(7));
const program = getReadonlyProgram(new Connection("http://127.0.0.1:1"), agent.publicKey);
const BLOCKHASH = new PublicKey(new Uint8Array(32).fill(3)).toBase58();
const SIGNATURE = "5uCXVGHUYpCgPBW4qJfyKsaUGov3E12avRn6YzBFQa7CTGPnV1fEAAUgfisvBjHvDQzC31Gdrn6sChPFGSz3Jih8";

async function policyAccountData(agentKey: PublicKey = agent.publicKey) {
  return program.coder.accounts.encode("agentPolicy", {
    owner,
    agent: agentKey,
    mint,
    vault: PublicKey.default,
    policyId: Array(32).fill(7),
    maxPerTx: new BN(10_000_000),
    dailyLimit: new BN(20_000_000),
    spentToday: new BN(0),
    dayIndex: new BN(Math.floor(NOW / 86_400)),
    isPaused: false,
    createdAt: new BN(NOW),
    bump: 255,
  });
}

interface FakeOptions {
  policyData: Buffer;
  receiptExists?: () => boolean;
  simulateErr?: unknown;
  simulateLogs?: string[];
  confirm?: () => Promise<{ value: { err: unknown } }>;
  txErr?: unknown;
  txLogs?: string[];
  signatureStatus?: { confirmationStatus: string; err: unknown; slot: number } | null;
}

function fakeRpc(o: FakeOptions) {
  const sent: Uint8Array[] = [];
  const calls = { simulate: 0, send: 0 };
  const rpc = {
    getAccountInfoAndContext: async (addr: PublicKey) => ({
      context: { slot: 100 },
      value: addr.equals(policy)
        ? { owner: PROGRAM_ID, data: o.policyData, lamports: 1, executable: false, rentEpoch: 0 }
        : null,
    }),
    getAccountInfo: async () =>
      o.receiptExists?.() ? { owner: PROGRAM_ID, data: Buffer.alloc(185), lamports: 1, executable: false } : null,
    getSlot: async () => 100,
    getBlockTime: async () => NOW,
    getLatestBlockhash: async () => ({ blockhash: BLOCKHASH, lastValidBlockHeight: 1000 }),
    simulateTransaction: async () => {
      calls.simulate++;
      return { value: { err: o.simulateErr ?? null, logs: o.simulateLogs ?? [], unitsConsumed: 1234 } };
    },
    sendRawTransaction: async (raw: Uint8Array) => {
      calls.send++;
      sent.push(raw);
      return SIGNATURE;
    },
    confirmTransaction: async () => (o.confirm ? o.confirm() : { value: { err: null } }),
    getTransaction: async () => ({ meta: { err: o.txErr ?? null, logMessages: o.txLogs ?? [] } }),
    getSignatureStatuses: async () => ({ value: [o.signatureStatus ?? null] }),
  };
  return { rpc: rpc as unknown as PaymentRpc, sent, calls };
}

function deps(rpc: PaymentRpc, extra: Partial<PaymentDeps> = {}): PaymentDeps {
  return {
    rpc,
    program,
    agent,
    allowedOwners: new Set([owner.toBase58()]),
    demoMode: false,
    confirmTimeoutMs: 2_000,
    ...extra,
  };
}

const prepareInput = (amount = "5000000") =>
  PrepareRequestSchema.parse({ policy: policy.toBase58(), merchant: merchant.toBase58(), amount });

async function prepared(d: PaymentDeps, amount = "5000000") {
  const r = await preparePayment(d, prepareInput(amount));
  expect(r.status).toBe("READY_TO_SIGN");
  return r.preparedPayment!;
}

const submitInput = (p: { policy: string; merchant: string; amount: string; requestId: string; expiresAt: number; requestHash: string }, extra = {}) =>
  SubmitRequestSchema.parse({
    policy: p.policy,
    merchant: p.merchant,
    amount: p.amount,
    requestId: p.requestId,
    expiresAt: p.expiresAt,
    requestHash: p.requestHash,
    ...extra,
  });

let policyData: Buffer;
beforeEach(async () => {
  policyData = await policyAccountData();
});

describe("preparePayment", () => {
  it("returns READY_TO_SIGN with canonical fields from chain + server config", async () => {
    const { rpc, calls } = fakeRpc({ policyData });
    const r = await preparePayment(deps(rpc), prepareInput());
    expect(r.httpStatus).toBe(200);
    expect(r.status).toBe("READY_TO_SIGN");
    const p = r.preparedPayment!;
    expect(p.mint).toBe(mint.toBase58()); // from chain, not from the request
    expect(p.expiresAt).toBe(NOW + 300); // cluster time + default TTL
    expect(p.requestId).toMatch(/^[0-9a-f]{32}$/);
    expect(p.receipt).toBe(receiptPda(policy, hexToBytes(p.requestHash, 32))[0].toBase58());
    expect(r.simulation).toMatchObject({ ok: true, unitsConsumed: 1234 });
    expect(calls.send).toBe(0); // prepare never sends
  });

  it("simulation rejection (EP-03 logs) → REJECTED, evidence SIMULATION, no signature (422)", async () => {
    const { rpc } = fakeRpc({
      policyData,
      simulateErr: { InstructionError: [0, { Custom: 3012 }] },
      simulateLogs: [
        "Program log: AnchorError caused by account: merchant_allowlist. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: x.",
      ],
    });
    const r = await preparePayment(deps(rpc), prepareInput());
    expect(r).toMatchObject({ httpStatus: 422, status: "REJECTED", evidence: "SIMULATION", reason: "MERCHANT_NOT_ALLOWLISTED" });
    expect(r.signature).toBeUndefined();
  });

  it("existing receipt → REJECTED by PRECHECK (409), nothing simulated", async () => {
    const { rpc, calls } = fakeRpc({ policyData, receiptExists: () => true });
    const r = await preparePayment(deps(rpc), prepareInput());
    expect(r).toMatchObject({ httpStatus: 409, status: "REJECTED", evidence: "PRECHECK", reason: "DUPLICATE_REQUEST" });
    expect(calls.simulate).toBe(0);
  });

  it("policy not served: owner not allowlisted / different agent → 403 POLICY_NOT_SERVED", async () => {
    const { rpc } = fakeRpc({ policyData });
    await expect(preparePayment(deps(rpc, { allowedOwners: new Set() }), prepareInput())).rejects.toMatchObject({
      httpStatus: 403,
      code: "POLICY_NOT_SERVED",
      details: { reason: "ALLOWLIST_NOT_CONFIGURED" },
    });
    const other = fakeRpc({ policyData: await policyAccountData(Keypair.generate().publicKey) });
    await expect(preparePayment(deps(other.rpc), prepareInput())).rejects.toMatchObject({
      code: "POLICY_NOT_SERVED",
      details: { reason: "AGENT_MISMATCH" },
    });
  });

  it("unknown policy → 404 NOT_FOUND", async () => {
    const { rpc } = fakeRpc({ policyData });
    const input = PrepareRequestSchema.parse({ policy: owner.toBase58(), merchant: merchant.toBase58(), amount: "1" });
    await expect(preparePayment(deps(rpc), input)).rejects.toMatchObject({ httpStatus: 404, code: "NOT_FOUND" });
  });
});

describe("submitPayment", () => {
  it("API-03: hash not matching the fields → 400 HASH_MISMATCH, nothing signed or sent", async () => {
    const { rpc, calls } = fakeRpc({ policyData });
    const d = deps(rpc);
    const p = await prepared(d);
    const tamperedAmount = submitInput({ ...p, amount: "9000000" });
    const wrongHash = submitInput({ ...p, requestHash: "00".repeat(32) });
    for (const input of [tamperedAmount, wrongHash]) {
      const err = await submitPayment(d, input).catch((e) => e);
      expect(err).toBeInstanceOf(PaymentServiceError);
      expect(err).toMatchObject({ httpStatus: 400, code: "HASH_MISMATCH" });
    }
    expect(calls.send).toBe(0);
  });

  it("happy path: prepared fields round-trip → CONFIRMED only with receipt; agent alone signs + pays fees", async () => {
    let landed = false;
    const { rpc, sent } = fakeRpc({
      policyData,
      receiptExists: () => landed,
      confirm: async () => {
        landed = true;
        return { value: { err: null } };
      },
    });
    const d = deps(rpc);
    const r = await submitPayment(d, submitInput(await prepared(d)));
    expect(r).toMatchObject({ httpStatus: 200, status: "CONFIRMED", signature: SIGNATURE });
    expect(r.receipt).toBeDefined();
    expect(r.policyAfter).toBeDefined();

    const tx = Transaction.from(sent[0]);
    expect(tx.feePayer?.equals(agent.publicKey)).toBe(true);
    expect(tx.signatures.map((s) => s.publicKey.toBase58())).toEqual([agent.publicKey.toBase58()]);
    expect(tx.verifySignatures()).toBe(true);
    expect(tx.instructions).toHaveLength(1);
    expect(tx.instructions[0].programId.equals(PROGRAM_ID)).toBe(true);
  });

  it("API-04: lands but fails on-chain → REJECTED with ONCHAIN evidence (422), never CONFIRMED", async () => {
    const { rpc } = fakeRpc({
      policyData,
      confirm: async () => ({ value: { err: { InstructionError: [0, { Custom: 6009 }] } } }),
      txErr: { InstructionError: [0, { Custom: 6009 }] },
    });
    const d = deps(rpc);
    const r = await submitPayment(d, submitInput(await prepared(d)));
    expect(r).toMatchObject({
      httpStatus: 422,
      status: "REJECTED",
      evidence: "ONCHAIN",
      reason: "EXCEEDS_DAILY_LIMIT",
      signature: SIGNATURE,
    });
  });

  it("API-04: confirmed without error but no receipt → FAILED, never CONFIRMED", async () => {
    const { rpc } = fakeRpc({ policyData, receiptExists: () => false });
    const d = deps(rpc);
    const r = await submitPayment(d, submitInput(await prepared(d)));
    expect(r).toMatchObject({ httpStatus: 502, status: "FAILED", reason: "UNKNOWN_ERROR" });
  });

  it("API-05: confirmation timeout → SUBMITTED (202) with signature to poll", async () => {
    const { rpc } = fakeRpc({ policyData, confirm: () => new Promise(() => {}) });
    const d = deps(rpc, { confirmTimeoutMs: 50 });
    const r = await submitPayment(d, submitInput(await prepared(d)));
    expect(r).toMatchObject({ httpStatus: 202, status: "SUBMITTED", signature: SIGNATURE });
  });

  it("blockhash expired and signature unknown → FAILED NOT_LANDED (retry with same requestId is safe)", async () => {
    const { rpc } = fakeRpc({
      policyData,
      confirm: async () => {
        throw new Error("block height exceeded");
      },
      signatureStatus: null,
    });
    const d = deps(rpc);
    const r = await submitPayment(d, submitInput(await prepared(d)));
    expect(r).toMatchObject({ status: "FAILED", reason: "NOT_LANDED" });
  });

  it("duplicate: existing receipt → PRECHECK rejection unless demo force", async () => {
    const { rpc, calls } = fakeRpc({ policyData, receiptExists: () => true });
    const d = deps(rpc);
    const p = (await preparePayment(deps(fakeRpc({ policyData }).rpc), prepareInput())).preparedPayment!;
    const r = await submitPayment(d, submitInput(p));
    expect(r).toMatchObject({ httpStatus: 409, status: "REJECTED", evidence: "PRECHECK", reason: "DUPLICATE_REQUEST" });
    expect(calls.send).toBe(0);
  });

  it("demoForceSubmit is refused unless DEMO_MODE, and skips simulation when allowed", async () => {
    const { rpc } = fakeRpc({ policyData });
    const d = deps(rpc);
    const p = await prepared(d);
    await expect(submitPayment(d, submitInput(p, { demoForceSubmit: true }))).rejects.toMatchObject({
      httpStatus: 403,
      code: "DEMO_DISABLED",
    });

    const demo = fakeRpc({
      policyData,
      confirm: async () => ({ value: { err: { InstructionError: [0, { Custom: 3012 }] } } }),
      txErr: { InstructionError: [0, { Custom: 3012 }] },
      txLogs: [
        "Program log: AnchorError caused by account: merchant_allowlist. Error Code: AccountNotInitialized. Error Number: 3012. Error Message: x.",
      ],
    });
    const r = await submitPayment(deps(demo.rpc, { demoMode: true }), submitInput(p, { demoForceSubmit: true }));
    expect(demo.calls.simulate).toBe(0);
    expect(r).toMatchObject({ status: "REJECTED", evidence: "ONCHAIN", reason: "MERCHANT_NOT_ALLOWLISTED" });
  });

  it("schemas reject unknown fields (e.g. a smuggled owner or serialized transaction)", () => {
    const base = { policy: policy.toBase58(), merchant: merchant.toBase58(), amount: "1" };
    expect(PrepareRequestSchema.safeParse({ ...base, owner: owner.toBase58() }).success).toBe(false);
    expect(PrepareRequestSchema.safeParse({ ...base, transaction: "AQAB" }).success).toBe(false);
  });
});

describe("owner session (T-M4-16)", () => {
  it("required: no session → 401, non-owner session → 403, owner session → proceeds", async () => {
    const { rpc } = fakeRpc({ policyData });
    await expect(
      preparePayment(deps(rpc, { ownerSession: { required: true, wallet: null } }), prepareInput()),
    ).rejects.toMatchObject({ httpStatus: 401, code: "OWNER_SESSION_REQUIRED" });
    await expect(
      preparePayment(deps(rpc, { ownerSession: { required: true, wallet: Keypair.generate().publicKey.toBase58() } }), prepareInput()),
    ).rejects.toMatchObject({ httpStatus: 403, code: "NOT_POLICY_OWNER" });
    const ok = await preparePayment(deps(rpc, { ownerSession: { required: true, wallet: owner.toBase58() } }), prepareInput());
    expect(ok.status).toBe("READY_TO_SIGN");
  });

  it("not required: payments work without a session (default)", async () => {
    const { rpc } = fakeRpc({ policyData });
    const r = await preparePayment(deps(rpc, { ownerSession: { required: false, wallet: null } }), prepareInput());
    expect(r.status).toBe("READY_TO_SIGN");
  });
});

describe("separate fee payer (T-M4-19)", () => {
  it("fee payer pays the transaction fee; the agent still signs execute_payment (and pays receipt rent)", async () => {
    const feePayer = Keypair.generate();
    let landed = false;
    const { rpc, sent } = fakeRpc({
      policyData,
      receiptExists: () => landed,
      confirm: async () => {
        landed = true;
        return { value: { err: null } };
      },
    });
    const d = deps(rpc, { feePayer });
    const r = await submitPayment(d, submitInput(await prepared(d)));
    expect(r.status).toBe("CONFIRMED");

    const tx = Transaction.from(sent[0]);
    expect(tx.feePayer?.equals(feePayer.publicKey)).toBe(true); // account 0 pays the fee
    expect(tx.signatures.map((s) => s.publicKey.toBase58()).sort()).toEqual(
      [feePayer.publicKey.toBase58(), agent.publicKey.toBase58()].sort(),
    );
    expect(tx.verifySignatures()).toBe(true);
    const ix = tx.instructions[0];
    const agentMeta = ix.keys.find((k) => k.pubkey.equals(agent.publicKey));
    expect(agentMeta).toMatchObject({ isSigner: true, isWritable: true }); // spending authority + receipt payer
    expect(ix.keys.some((k) => k.pubkey.equals(feePayer.publicKey))).toBe(false); // no role in the program
  });

  it("without a fee payer the agent pays its own fee (unchanged behavior)", async () => {
    const { rpc, sent } = fakeRpc({ policyData, receiptExists: () => sent.length > 0 });
    const d = deps(rpc, { feePayer: null });
    await submitPayment(d, submitInput(await prepared(d)));
    const tx = Transaction.from(sent[0]);
    expect(tx.feePayer?.equals(agent.publicKey)).toBe(true);
    expect(tx.signatures).toHaveLength(1);
  });
});

describe("timing", () => {
  it("timeout path does not wait for the configured default", async () => {
    vi.useRealTimers();
    const { rpc } = fakeRpc({ policyData, confirm: () => new Promise(() => {}) });
    const d = deps(rpc, { confirmTimeoutMs: 20 });
    const started = Date.now();
    await submitPayment(d, submitInput(await prepared(d)));
    expect(Date.now() - started).toBeLessThan(1_500);
  });
});
