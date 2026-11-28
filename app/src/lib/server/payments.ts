import "server-only";
import { BN } from "@anchor-lang/core";
import {
  type Connection,
  type Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import { PROGRAM_ID, receiptClosableAt } from "@/lib/anchor/constants";
import { type FailureReason, mapTransactionError, type MappedError } from "@/lib/anchor/errors";
import {
  merchantAllowlistPda,
  merchantLimitPda,
  merchantTokenAccount,
  receiptPda,
  spendingRulesPda,
  tokenProgramForPolicy,
  vaultAddress,
} from "@/lib/anchor/pda";
import type { AgentPaymentFirewallProgram } from "@/lib/anchor/program";
import { computeRequestHash, newRequestId } from "@/lib/anchor/requestHash";
import { bytesToHex, hexToBytes } from "@/lib/encoding/hex";
import { clusterUnixTime, type DecodedPolicy, loadPolicy } from "@/lib/policy/read";
import { explorerTxUrl } from "@/lib/solana/explorer";
import type { Evidence, PaymentStatus } from "@/lib/validation/common";
import type { PrepareRequest, SubmitRequest } from "@/lib/validation/payments";
import { checkPolicyServed } from "./access";
import { type AgentKey, AgentSignerError, MEMO_PROGRAM_ID, signAgentTransaction } from "./agentSigner";

// Payment preparation, submission and status (docs/06 §3.4–3.6, docs/11 §6).
// Invariants:
//  - The agent signs ONLY transactions this module builds from validated fields; client
//    transaction bytes are never accepted.
//  - Owner, agent and mint come from chain / server config, never from the request body.
//  - CONFIRMED requires: confirmed signature AND meta.err == null AND receipt account exists.
//    RPC acceptance alone is SUBMITTED.

/** The RPC methods this module uses (a real Connection satisfies it; tests use a fake). */
export type PaymentRpc = Pick<
  Connection,
  | "getAccountInfoAndContext"
  | "getAccountInfo"
  | "getSlot"
  | "getBlockTime"
  | "getLatestBlockhash"
  | "simulateTransaction"
  | "sendRawTransaction"
  | "confirmTransaction"
  | "getTransaction"
  | "getSignatureStatuses"
>;

export interface PaymentDeps {
  rpc: PaymentRpc;
  program: AgentPaymentFirewallProgram;
  /** Server agent: local keypair or a KMS/MPC signer (F-04); null when not configured. */
  agent: AgentKey | null;
  /**
   * Optional separate fee payer (T-M4-19). Pays the transaction fee only; the agent still signs
   * `execute_payment` and pays the receipt rent. Defaults to the agent.
   */
  feePayer?: Keypair | null;
  allowedOwners: ReadonlySet<string>;
  demoMode: boolean;
  /** Owner-session requirement (T-M4-16); absent = not required. */
  ownerSession?: { required: boolean; wallet: string | null };
  /** How long submit waits for `confirmed` before answering SUBMITTED (default 25 s). */
  confirmTimeoutMs?: number;
}

/** Request-level failure (validation, access, not found, config) → HTTP error envelope. */
export class PaymentServiceError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "PaymentServiceError";
  }
}

export interface PreparedPayment {
  policy: string;
  merchant: string;
  merchantTokenAccount: string;
  mint: string;
  vault: string;
  amount: string;
  requestId: string;
  expiresAt: number;
  requestHash: string;
  receipt: string;
}

/** Outcome of a payment operation. `httpStatus` is the response code to use. */
export interface PaymentResult {
  httpStatus: number;
  status: PaymentStatus;
  evidence?: Evidence;
  reason?: FailureReason;
  programError?: { code: number | null; name: string | null; account: string | null };
  signature?: string;
  explorerUrl?: string;
  preparedPayment?: PreparedPayment;
  simulation?: { ok: boolean; unitsConsumed: number | null; logs: string[] };
  receipt?: string;
  slot?: number;
  policyAfter?: { spentToday: string; dayIndex: number };
  logs?: string[];
  message?: string;
}

const DEFAULT_CONFIRM_TIMEOUT_MS = 25_000;

// ---------------------------------------------------------------------------- helpers

function toPubkey(value: string): PublicKey {
  return new PublicKey(value);
}

async function resolveServedPolicy(deps: PaymentDeps, address: PublicKey): Promise<DecodedPolicy> {
  const lookup = await loadPolicy(deps.rpc, deps.program, address);
  if (lookup.kind === "missing") throw new PaymentServiceError(404, "NOT_FOUND", "no account at this address");
  if (lookup.kind === "not_a_policy") {
    throw new PaymentServiceError(404, "NOT_A_POLICY", "account is not an AgentPay Guard policy");
  }
  // T-M4-16: optional owner session (REQUIRE_OWNER_SESSION=true). The session wallet must be
  // the policy's ON-CHAIN owner — never an owner address sent by the client.
  if (deps.ownerSession?.required) {
    if (!deps.ownerSession.wallet) {
      throw new PaymentServiceError(401, "OWNER_SESSION_REQUIRED", "sign in with the policy owner's wallet first");
    }
    if (deps.ownerSession.wallet !== lookup.policy.owner.toBase58()) {
      throw new PaymentServiceError(403, "NOT_POLICY_OWNER", "the signed-in wallet is not the owner of this policy");
    }
  }
  const decision = checkPolicyServed(lookup.policy, deps.agent?.publicKey ?? null, deps.allowedOwners);
  if (!decision.allowed) {
    throw new PaymentServiceError(403, "POLICY_NOT_SERVED", "this server's agent does not act for this policy", {
      reason: decision.reason,
    });
  }
  return lookup.policy;
}

interface PaymentFields {
  policy: PublicKey;
  merchant: PublicKey;
  mint: PublicKey;
  /** Classic SPL Token or Token-2022 (F-05), from the policy's vault. Not part of the hash. */
  tokenProgram: PublicKey;
  amount: bigint;
  requestId: Uint8Array;
  expiresAt: bigint;
  requestHash: Uint8Array;
}

function accountsFor(f: PaymentFields) {
  return {
    merchantAllowlist: merchantAllowlistPda(f.policy, f.merchant)[0],
    spendingRules: spendingRulesPda(f.policy)[0],
    merchantLimit: merchantLimitPda(f.policy, f.merchant)[0],
    vault: vaultAddress(f.policy, f.mint, f.tokenProgram),
    merchantTokenAccount: merchantTokenAccount(f.merchant, f.mint, f.tokenProgram),
    receipt: receiptPda(f.policy, f.requestHash)[0],
  };
}

function describe(f: PaymentFields): PreparedPayment {
  const a = accountsFor(f);
  return {
    policy: f.policy.toBase58(),
    merchant: f.merchant.toBase58(),
    merchantTokenAccount: a.merchantTokenAccount.toBase58(),
    mint: f.mint.toBase58(),
    vault: a.vault.toBase58(),
    amount: f.amount.toString(),
    requestId: bytesToHex(f.requestId),
    expiresAt: Number(f.expiresAt),
    requestHash: bytesToHex(f.requestHash),
    receipt: a.receipt.toBase58(),
  };
}

async function buildTransaction(deps: PaymentDeps, agent: AgentKey, f: PaymentFields) {
  const a = accountsFor(f);
  const ix = await deps.program.methods
    .executePayment(
      Array.from(f.requestHash),
      Array.from(f.requestId),
      new BN(f.amount.toString()),
      new BN(f.expiresAt.toString()),
    )
    .accountsStrict({
      agent: agent.publicKey,
      policy: f.policy,
      merchant: f.merchant,
      merchantAllowlist: a.merchantAllowlist,
      spendingRules: a.spendingRules,
      merchantLimit: a.merchantLimit,
      mint: f.mint,
      vault: a.vault,
      merchantTokenAccount: a.merchantTokenAccount,
      receipt: a.receipt,
      tokenProgram: f.tokenProgram,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const { blockhash, lastValidBlockHeight } = await deps.rpc.getLatestBlockhash("confirmed");
  const feePayer = deps.feePayer ?? agent;
  const tx = new Transaction({ feePayer: feePayer.publicKey, blockhash, lastValidBlockHeight }).add(ix);
  return { tx, blockhash, lastValidBlockHeight };
}

async function simulate(deps: PaymentDeps, tx: Transaction) {
  const res = await deps.rpc.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
    sigVerify: false,
    replaceRecentBlockhash: true,
    commitment: "confirmed",
  });
  return { err: res.value.err, logs: res.value.logs ?? [], unitsConsumed: res.value.unitsConsumed ?? null };
}

function failureResult(
  mapped: MappedError,
  evidence: Evidence,
  extra: Partial<PaymentResult> = {},
): PaymentResult {
  const where =
    evidence === "SIMULATION"
      ? "in simulation — no transaction was submitted"
      : "on-chain — the failed transaction is recorded on the cluster";
  return {
    httpStatus: mapped.status === "REJECTED" ? 422 : 502,
    status: mapped.status,
    evidence,
    reason: mapped.reason,
    programError: { code: mapped.code, name: mapped.name, account: mapped.account },
    message:
      mapped.status === "REJECTED"
        ? `payment rejected by the on-chain policy (${mapped.reason}) ${where}`
        : `payment failed (${mapped.reason}) ${where}`,
    ...extra,
  };
}

function duplicatePrecheck(prepared: PreparedPayment): PaymentResult {
  return {
    httpStatus: 409,
    status: "REJECTED",
    evidence: "PRECHECK",
    reason: "DUPLICATE_REQUEST",
    message: "a receipt for this request already exists (it was already executed)",
    preparedPayment: prepared,
  };
}

async function clusterNow(deps: PaymentDeps): Promise<bigint> {
  const { unixTime } = await clusterUnixTime(deps.rpc);
  if (unixTime === null) throw new PaymentServiceError(502, "RPC_ERROR", "cluster time unavailable");
  return BigInt(unixTime);
}

function requireAgent(deps: PaymentDeps): AgentKey {
  if (!deps.agent) throw new PaymentServiceError(503, "CONFIG_ERROR", "agent key is not configured");
  return deps.agent;
}

// ---------------------------------------------------------------------------- prepare

/** POST /payments/prepare: assign id + expiry, hash, build, precheck and simulate. */
export async function preparePayment(deps: PaymentDeps, input: PrepareRequest): Promise<PaymentResult> {
  const agent = requireAgent(deps);
  const policyAddress = toPubkey(input.policy);
  const policy = await resolveServedPolicy(deps, policyAddress);

  const now = await clusterNow(deps);
  const requestId = input.requestId ? hexToBytes(input.requestId, 16) : newRequestId();
  const fields: Omit<PaymentFields, "requestHash"> = {
    policy: policyAddress,
    merchant: toPubkey(input.merchant),
    mint: policy.mint,
    tokenProgram: tokenProgramForPolicy(policyAddress, policy.mint, policy.vault),
    amount: BigInt(input.amount),
    requestId,
    expiresAt: now + BigInt(input.expiresInSeconds),
  };
  const requestHash = computeRequestHash({ ...fields, agent: agent.publicKey });
  const full: PaymentFields = { ...fields, requestHash };
  const prepared = describe(full);

  if (await deps.rpc.getAccountInfo(accountsFor(full).receipt, "confirmed")) return duplicatePrecheck(prepared);

  const { tx } = await buildTransaction(deps, agent, full);
  const sim = await simulate(deps, tx);
  if (sim.err) {
    return failureResult(mapTransactionError(sim.err, sim.logs), "SIMULATION", {
      preparedPayment: prepared,
      simulation: { ok: false, unitsConsumed: sim.unitsConsumed, logs: sim.logs },
    });
  }
  return {
    httpStatus: 200,
    status: "READY_TO_SIGN",
    preparedPayment: prepared,
    simulation: { ok: true, unitsConsumed: sim.unitsConsumed, logs: sim.logs },
  };
}

// ---------------------------------------------------------------------------- sponsored (x402)

/**
 * Mint of a policy this server serves (same access checks as prepare: served policy, owner
 * session when required). Used by the x402 client to pick a matching requirement.
 */
export async function servedPolicyMint(deps: PaymentDeps, policy: string): Promise<string> {
  requireAgent(deps);
  return (await resolveServedPolicy(deps, toPubkey(policy))).mint.toBase58();
}

export interface SponsoredPayment {
  /** Base64 of the agent-signed transaction; the sponsor's fee-payer signature is missing. */
  transactionBase64: string;
  preparedPayment: PreparedPayment;
}

/**
 * F-01 x402 `exact` on Solana (docs/14 design B): the same policy checks and simulation as
 * `preparePayment`, then a transaction whose fee payer is the external SPONSOR (facilitator or
 * merchant) with one Memo instruction, signed by the agent only. The sponsor is never in any
 * instruction (it only pays the fee), and the agent still pays the receipt rent.
 * Returns the normal failure result when the policy rejects the payment (nothing is signed).
 */
export async function prepareSponsoredPayment(
  deps: PaymentDeps,
  input: PrepareRequest,
  sponsor: { feePayer: PublicKey; memo: string; recentBlockhash?: string },
): Promise<{ ok: true; payment: SponsoredPayment } | { ok: false; result: PaymentResult }> {
  if (Buffer.byteLength(sponsor.memo, "utf8") > 256) {
    throw new PaymentServiceError(400, "VALIDATION_ERROR", "memo longer than 256 bytes");
  }
  const agent = requireAgent(deps);
  if (sponsor.feePayer.equals(agent.publicKey)) {
    throw new PaymentServiceError(400, "VALIDATION_ERROR", "sponsor fee payer must not be the agent");
  }
  const result = await preparePayment(deps, input);
  if (result.status !== "READY_TO_SIGN" || !result.preparedPayment) return { ok: false, result };
  const pp = result.preparedPayment;
  const policy = toPubkey(pp.policy);
  const mint = toPubkey(pp.mint);
  const full: PaymentFields = {
    policy,
    merchant: toPubkey(pp.merchant),
    mint,
    tokenProgram: tokenProgramForPolicy(policy, mint, toPubkey(pp.vault)),
    amount: BigInt(pp.amount),
    requestId: hexToBytes(pp.requestId, 16),
    expiresAt: BigInt(pp.expiresAt),
    requestHash: hexToBytes(pp.requestHash, 32),
  };
  const { tx } = await buildTransaction(deps, agent, full);
  tx.feePayer = sponsor.feePayer;
  if (sponsor.recentBlockhash) tx.recentBlockhash = sponsor.recentBlockhash;
  tx.add(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(sponsor.memo, "utf8") }));
  await signAgentTransaction(tx, agent, sponsor.feePayer);
  const raw = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  return { ok: true, payment: { transactionBase64: Buffer.from(raw).toString("base64"), preparedPayment: pp } };
}

// ---------------------------------------------------------------------------- submit

type ConfirmOutcome = { kind: "confirmed"; err: unknown } | { kind: "timeout" } | { kind: "expired" };

async function waitForConfirmation(
  deps: PaymentDeps,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
): Promise<ConfirmOutcome> {
  const timeoutMs = deps.confirmTimeoutMs ?? DEFAULT_CONFIRM_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ConfirmOutcome>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const confirm = deps.rpc
    .confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed")
    .then((r): ConfirmOutcome => ({ kind: "confirmed", err: r.value.err }))
    .catch(async (): Promise<ConfirmOutcome> => {
      // Blockhash expired (or confirm failed): the transaction may still have landed.
      const st = await deps.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
      const s = st.value[0];
      if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
        return { kind: "confirmed", err: s.err };
      }
      return { kind: "expired" };
    });
  try {
    return await Promise.race([confirm, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * POST /payments/submit: recompute + compare the hash, rebuild the transaction, (simulate),
 * sign with the agent, send, and confirm.
 */
export async function submitPayment(deps: PaymentDeps, input: SubmitRequest): Promise<PaymentResult> {
  const agent = requireAgent(deps);
  if (input.demoForceSubmit && !deps.demoMode) {
    throw new PaymentServiceError(403, "DEMO_DISABLED", "demoForceSubmit requires DEMO_MODE=true");
  }
  const policyAddress = toPubkey(input.policy);
  const policy = await resolveServedPolicy(deps, policyAddress);

  // API-03: the hash must be the canonical hash of THESE fields with the on-chain mint and
  // this server's agent. Detects tampering and stale/inconsistent prepared payments.
  const fields: Omit<PaymentFields, "requestHash"> = {
    policy: policyAddress,
    merchant: toPubkey(input.merchant),
    mint: policy.mint,
    tokenProgram: tokenProgramForPolicy(policyAddress, policy.mint, policy.vault),
    amount: BigInt(input.amount),
    requestId: hexToBytes(input.requestId, 16),
    expiresAt: BigInt(input.expiresAt),
  };
  const requestHash = computeRequestHash({ ...fields, agent: agent.publicKey });
  if (bytesToHex(requestHash) !== input.requestHash) {
    throw new PaymentServiceError(400, "HASH_MISMATCH", "requestHash does not match the payment fields");
  }
  const full: PaymentFields = { ...fields, requestHash };
  const prepared = describe(full);
  const force = input.demoForceSubmit && deps.demoMode;

  if (!force && (await deps.rpc.getAccountInfo(accountsFor(full).receipt, "confirmed"))) {
    return duplicatePrecheck(prepared);
  }

  const { tx, blockhash, lastValidBlockHeight } = await buildTransaction(deps, agent, full);
  if (!force) {
    const sim = await simulate(deps, tx);
    if (sim.err) {
      return failureResult(mapTransactionError(sim.err, sim.logs), "SIMULATION", {
        preparedPayment: prepared,
        logs: sim.logs,
      });
    }
  }

  // Pre-sign guard, then fee payer (account 0) and agent signatures (F-04 signer interface).
  try {
    await signAgentTransaction(tx, agent, deps.feePayer ?? null);
  } catch (e) {
    if (e instanceof AgentSignerError) {
      return {
        httpStatus: 502,
        status: "FAILED",
        reason: "UNKNOWN_ERROR",
        message: `agent signer refused: ${e.message}`,
        preparedPayment: prepared,
      };
    }
    throw e;
  }
  let signature: string;
  try {
    // Already simulated above (or deliberately forced in demo mode).
    signature = await deps.rpc.sendRawTransaction(tx.serialize(), { skipPreflight: true, maxRetries: 3 });
  } catch {
    return {
      httpStatus: 502,
      status: "FAILED",
      reason: "UNKNOWN_ERROR",
      message: "RPC rejected the transaction submission",
      preparedPayment: prepared,
    };
  }
  const sent = { signature, explorerUrl: explorerTxUrl(signature), preparedPayment: prepared };

  const outcome = await waitForConfirmation(deps, signature, blockhash, lastValidBlockHeight);
  if (outcome.kind === "timeout") {
    // API-05: never claim success without confirmation; the client polls GET /payments/:sig.
    return { httpStatus: 202, status: "SUBMITTED", message: "awaiting confirmation", ...sent };
  }
  if (outcome.kind === "expired") {
    return {
      httpStatus: 502,
      status: "FAILED",
      reason: "NOT_LANDED",
      message: "blockhash expired before the transaction landed; retrying with the same requestId is safe",
      ...sent,
    };
  }
  if (outcome.err) {
    // API-04: landed but failed on-chain → REJECTED/FAILED with on-chain evidence, never CONFIRMED.
    const txInfo = await deps.rpc
      .getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 })
      .catch(() => null);
    const logs = txInfo?.meta?.logMessages ?? [];
    return failureResult(mapTransactionError(outcome.err, logs), "ONCHAIN", { ...sent, logs });
  }

  // Confirmed without error: still require the receipt account before reporting CONFIRMED.
  const receiptInfo = await deps.rpc.getAccountInfo(accountsFor(full).receipt, "confirmed");
  if (!receiptInfo || !receiptInfo.owner.equals(PROGRAM_ID)) {
    return {
      httpStatus: 502,
      status: "FAILED",
      reason: "UNKNOWN_ERROR",
      message: "transaction confirmed but the payment receipt was not found",
      ...sent,
    };
  }
  const after = await loadPolicy(deps.rpc, deps.program, policyAddress);
  return {
    httpStatus: 200,
    status: "CONFIRMED",
    receipt: prepared.receipt,
    policyAfter:
      after.kind === "found"
        ? { spentToday: after.policy.spentToday.toString(), dayIndex: Number(after.policy.dayIndex.toString()) }
        : undefined,
    ...sent,
  };
}

// ---------------------------------------------------------------------------- status

export interface PaymentStatusResult {
  httpStatus: number;
  status: PaymentStatus;
  signature: string;
  explorerUrl: string;
  confirmationStatus: string | null;
  slot: number | null;
  blockTime: number | null;
  error: MappedError | null;
  payment: {
    policy: string;
    receipt: string;
    merchant: string;
    agent: string;
    amount: string;
    requestHash: string;
    /** Cluster time of execution (PaymentExecuted.timestamp). */
    createdAt: number;
    /** F-02: the receipt was closed after its grace period (rent refunded); still CONFIRMED. */
    receiptClosed: boolean;
  } | null;
}

/** GET /payments/[signature]: authoritative status from the cluster (docs/06 §3.6). */
export async function getPaymentStatus(deps: PaymentDeps, signature: string): Promise<PaymentStatusResult> {
  const statuses = await deps.rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
  const st = statuses.value[0];
  if (!st) throw new PaymentServiceError(404, "NOT_FOUND", "signature not found (it may still be in flight)");

  const base = {
    signature,
    explorerUrl: explorerTxUrl(signature),
    confirmationStatus: st.confirmationStatus ?? null,
    slot: st.slot,
  };
  const tx = await deps.rpc.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) {
    return { ...base, httpStatus: 200, status: "SUBMITTED", blockTime: null, error: null, payment: null };
  }
  const touchesProgram = tx.transaction.message.staticAccountKeys.some((k) => k.equals(PROGRAM_ID));
  if (!touchesProgram) {
    throw new PaymentServiceError(404, "NOT_AN_AGENTPAY_TRANSACTION", "transaction does not involve the program");
  }
  const blockTime = tx.blockTime ?? null;
  const logs = tx.meta?.logMessages ?? [];

  if (tx.meta?.err) {
    const mapped = mapTransactionError(tx.meta.err, logs);
    return { ...base, httpStatus: 200, status: mapped.status, blockTime, error: mapped, payment: null };
  }

  let payment: PaymentStatusResult["payment"] = null;
  for (const line of logs) {
    if (!line.startsWith("Program data: ")) continue;
    const ev = deps.program.coder.events.decode(line.slice("Program data: ".length));
    if (ev && ev.name.toLowerCase() === "paymentexecuted") {
      const d = ev.data as Record<string, { toString(): string } | number[]>;
      payment = {
        policy: d.policy.toString(),
        receipt: d.receipt.toString(),
        merchant: d.merchant.toString(),
        agent: d.agent.toString(),
        amount: d.amount.toString(),
        requestHash: bytesToHex(Uint8Array.from(d.requestHash as number[])),
        createdAt: Number(d.timestamp.toString()),
        receiptClosed: false,
      };
      break;
    }
  }
  if (!payment) {
    // A successful program transaction without a PaymentExecuted event is not a payment (e.g.
    // pause_policy, add_merchant). Never report it as a CONFIRMED payment: CONFIRMED requires a
    // payment whose receipt we can check (docs/11 §6).
    throw new PaymentServiceError(
      404,
      "NOT_A_PAYMENT_TRANSACTION",
      "transaction succeeded but executed no payment (no PaymentExecuted event)",
    );
  }
  const final = st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized";
  if (final) {
    // Same rule as submit: a payment is CONFIRMED only if its receipt account exists.
    const receiptInfo = await deps.rpc.getAccountInfo(new PublicKey(payment.receipt), "confirmed");
    if (!receiptInfo || !receiptInfo.owner.equals(PROGRAM_ID)) {
      // F-02: a receipt may be closed (rent refunded) once its request can no longer execute.
      // The tx succeeded and the receipt existed then; only before the grace period is a
      // missing receipt an anomaly.
      if (Number(await clusterNow(deps)) >= receiptClosableAt(payment.createdAt)) {
        return {
          ...base,
          httpStatus: 200,
          status: "CONFIRMED",
          blockTime,
          error: null,
          payment: { ...payment, receiptClosed: true },
        };
      }
      return {
        ...base,
        httpStatus: 200,
        status: "FAILED",
        blockTime,
        error: { status: "FAILED", reason: "UNKNOWN_ERROR", code: null, name: "ReceiptMissing", account: "receipt" },
        payment,
      };
    }
  }
  return {
    ...base,
    httpStatus: 200,
    status: final ? "CONFIRMED" : "SUBMITTED",
    blockTime,
    error: null,
    payment,
  };
}
