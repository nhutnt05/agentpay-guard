import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  ComputeBudgetProgram,
  type Connection,
  type Keypair,
  PublicKey,
  Transaction,
  VersionedTransaction,
} from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/anchor/constants";
import { base58Decode } from "@/lib/encoding/base58";
import { MEMO_PROGRAM_ID } from "@/lib/server/agentSigner";
import {
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  type PaymentRequired,
  type PaymentRequirements,
  type SettlementResponse,
  SOLANA_DEVNET_CAIP2,
  X402_VERSION,
} from "./protocol";

// F-01 design B, sponsor side (docs/14 §3): a merchant-sponsored x402 resource that acts as its
// own facilitator. It answers 402 with an `exact` Solana requirement naming itself as fee payer,
// then VERIFIES the client's partially signed transaction the way the x402 SVM spec requires for
// "Path 2" smart-wallet payments (spec §1.4, §2.1, §3, with AgentPay Guard as the only allowed
// wrapping program), co-signs as fee payer, sends, confirms, and re-checks the settled transfer.
// Nothing here trusts the client: every rule is checked on the transaction bytes and on a
// simulation / the confirmed transaction.

const TOKEN_PROGRAM = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const TOKEN_2022_PROGRAM = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");
const TRANSFER = 3;
const TRANSFER_CHECKED = 12;
/** Programs allowed at top level: our firewall (the "smart wallet"), Compute Budget, Memo. */
const ALLOWED_TOP_LEVEL = [PROGRAM_ID, ComputeBudgetProgram.programId, MEMO_PROGRAM_ID];

export interface SponsorOptions {
  connection: Connection;
  /** Sponsor = fee payer of the payment transaction; signs only after verification. */
  sponsor: Keypair;
  payTo: PublicKey;
  asset: PublicKey;
  /** Token program that owns `asset` (classic SPL or Token-2022). */
  tokenProgram?: PublicKey;
  amount: bigint;
  maxTimeoutSeconds?: number;
  /** Seller memo (`extra.memo`); the transaction must carry exactly this memo. */
  memo?: string;
  /** Body served after a successful settlement. */
  content?: unknown;
  confirmTimeoutMs?: number;
}

export class SponsorVerifyError extends Error {
  constructor(readonly reason: string, message: string) {
    super(message);
  }
}

const b64json = (v: unknown) => Buffer.from(JSON.stringify(v), "utf8").toString("base64");

export function sponsorRequirement(o: SponsorOptions): PaymentRequirements {
  return {
    scheme: "exact",
    network: SOLANA_DEVNET_CAIP2,
    amount: o.amount.toString(),
    asset: o.asset.toBase58(),
    payTo: o.payTo.toBase58(),
    maxTimeoutSeconds: o.maxTimeoutSeconds ?? 120,
    extra: { feePayer: o.sponsor.publicKey.toBase58(), ...(o.memo ? { memo: o.memo } : {}) },
  };
}

interface TokenTransfer {
  kind: "transfer" | "transferChecked";
  programId: PublicKey;
  destination: PublicKey;
  mint: PublicKey | null;
  amount: bigint;
}

function decodeTokenTransfer(programId: PublicKey, accounts: PublicKey[], data: Uint8Array): TokenTransfer | null {
  if (!programId.equals(TOKEN_PROGRAM) && !programId.equals(TOKEN_2022_PROGRAM)) return null;
  const view = Buffer.from(data);
  if (view[0] === TRANSFER_CHECKED && view.length >= 10 && accounts.length >= 3) {
    return { kind: "transferChecked", programId, mint: accounts[1], destination: accounts[2], amount: view.readBigUInt64LE(1) };
  }
  if (view[0] === TRANSFER && view.length >= 9 && accounts.length >= 2) {
    return { kind: "transfer", programId, mint: null, destination: accounts[1], amount: view.readBigUInt64LE(1) };
  }
  return null;
}

/** Inner instructions of a simulation / confirmed tx, in either compiled or jsonParsed form. */
function transfersFromInner(inner: unknown, accountKeys: PublicKey[]): TokenTransfer[] {
  const out: TokenTransfer[] = [];
  for (const group of (inner as { instructions: unknown[] }[] | null | undefined) ?? []) {
    for (const ix of group.instructions as Record<string, unknown>[]) {
      if ("parsed" in ix && ix.parsed && typeof ix.parsed === "object") {
        const p = ix.parsed as { type?: string; info?: Record<string, unknown> };
        const programId = new PublicKey(String(ix.programId));
        if (p.type === "transferChecked" && p.info) {
          const amt = (p.info.tokenAmount as { amount?: string } | undefined)?.amount ?? "0";
          out.push({
            kind: "transferChecked",
            programId,
            mint: new PublicKey(String(p.info.mint)),
            destination: new PublicKey(String(p.info.destination)),
            amount: BigInt(amt),
          });
        } else if (p.type === "transfer" && p.info) {
          out.push({
            kind: "transfer",
            programId,
            mint: null,
            destination: new PublicKey(String(p.info.destination)),
            amount: BigInt(String(p.info.amount ?? "0")),
          });
        }
        continue;
      }
      const programIdIndex = ix.programIdIndex as number | undefined;
      if (programIdIndex === undefined) continue;
      const accounts = ((ix.accounts as number[]) ?? []).map((i) => accountKeys[i]);
      const t = decodeTokenTransfer(accountKeys[programIdIndex], accounts, base58Decode(String(ix.data)));
      if (t) out.push(t);
    }
  }
  return out;
}

/** Static checks on the client's partially signed transaction (no RPC). */
export function verifyPaymentTransaction(o: SponsorOptions, tx: Transaction): void {
  const sponsor = o.sponsor.publicKey;
  if (!tx.feePayer?.equals(sponsor)) throw new SponsorVerifyError("invalid_fee_payer", "fee payer must be the sponsor");
  // Spec §2.1.1: the fee payer must not appear in any instruction's accounts.
  if (tx.instructions.some((ix) => ix.keys.some((k) => k.pubkey.equals(sponsor)))) {
    throw new SponsorVerifyError("fee_payer_in_instruction", "sponsor appears in an instruction");
  }
  // Allowlist override: only AgentPay Guard may wrap the transfer (spec §3 smartWalletAllowedPrograms).
  for (const ix of tx.instructions) {
    if (!ALLOWED_TOP_LEVEL.some((p) => p.equals(ix.programId))) {
      throw new SponsorVerifyError("smart_wallet_program_not_allowed", `program ${ix.programId.toBase58()} not allowed`);
    }
    if (ix.programId.equals(MEMO_PROGRAM_ID) && ix.keys.length > 0) {
      throw new SponsorVerifyError("invalid_memo", "memo must not reference accounts");
    }
  }
  if (tx.instructions.filter((ix) => ix.programId.equals(PROGRAM_ID)).length !== 1) {
    throw new SponsorVerifyError("invalid_payload", "exactly one execute_payment instruction is required");
  }
  const memos = tx.instructions.filter((ix) => ix.programId.equals(MEMO_PROGRAM_ID));
  if (o.memo !== undefined && (memos.length !== 1 || Buffer.from(memos[0].data).toString("utf8") !== o.memo)) {
    throw new SponsorVerifyError("invalid_memo", "memo does not match extra.memo");
  }
  // Spec: no signatures beyond the client and the sponsor; the client's must be present and valid.
  const others = tx.signatures.filter((s) => !s.publicKey.equals(sponsor));
  if (others.length !== 1 || !others[0].signature) {
    throw new SponsorVerifyError("invalid_signers", "exactly one client signature is required");
  }
  if (!tx.verifySignatures(false)) throw new SponsorVerifyError("invalid_signature", "client signature is invalid");
}

function matchingTransfers(o: SponsorOptions, transfers: TokenTransfer[]) {
  const tokenProgram = o.tokenProgram ?? TOKEN_PROGRAM;
  const payToAta = getAssociatedTokenAddressSync(o.asset, o.payTo, false, tokenProgram);
  const toPayTo = transfers.filter((t) => t.destination.equals(payToAta));
  const ok = toPayTo.filter(
    (t) => t.kind === "transferChecked" && t.mint?.equals(o.asset) && t.programId.equals(tokenProgram) && t.amount >= o.amount,
  );
  return { payToAta, ok, toPayTo };
}

/** Verify (static + simulation), co-sign, send, confirm and re-check the settled transfer. */
export async function verifyAndSettle(o: SponsorOptions, transactionBase64: string): Promise<SettlementResponse> {
  const tx = Transaction.from(Buffer.from(transactionBase64, "base64"));
  verifyPaymentTransaction(o, tx);
  const client = tx.signatures.find((s) => !s.publicKey.equals(o.sponsor.publicKey))!.publicKey;

  tx.partialSign(o.sponsor);
  const accountKeys = tx.compileMessage().accountKeys;

  // Path 2: simulate with inner instructions; exactly one matching TransferChecked (spec §1.4).
  const sim = await o.connection.simulateTransaction(new VersionedTransaction(tx.compileMessage()), {
    sigVerify: false,
    innerInstructions: true,
    commitment: "confirmed",
  });
  if (sim.value.err) {
    throw new SponsorVerifyError("simulation_failed", `simulation failed: ${JSON.stringify(sim.value.err)}`);
  }
  const simTransfers = transfersFromInner(sim.value.innerInstructions, accountKeys);
  const simMatch = matchingTransfers(o, simTransfers);
  if (simMatch.ok.length !== 1 || simMatch.toPayTo.length !== 1) {
    throw new SponsorVerifyError(
      "invalid_transfer",
      `expected exactly one TransferChecked of >= ${o.amount} ${o.asset.toBase58()} to ${simMatch.payToAta.toBase58()}`,
    );
  }

  const signature = await o.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const deadline = Date.now() + (o.confirmTimeoutMs ?? 60_000);
  for (;;) {
    const st = (await o.connection.getSignatureStatuses([signature])).value[0];
    if (st?.err) throw new SponsorVerifyError("transaction_failed", `transaction failed: ${JSON.stringify(st.err)}`);
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) break;
    if (Date.now() > deadline) throw new SponsorVerifyError("transaction_not_confirmed", `not confirmed: ${signature}`);
    await new Promise((r) => setTimeout(r, 1_000));
  }

  // Post-confirmation re-check (spec Path 2): the confirmed inner instructions, with the payTo ATA
  // balance delta as a second witness.
  let landed = null;
  for (let i = 0; i < 10 && !landed; i++) {
    landed = await o.connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!landed) await new Promise((r) => setTimeout(r, 1_000));
  }
  if (!landed?.meta) throw new SponsorVerifyError("transaction_not_found", `confirmed tx not readable: ${signature}`);
  const keys = landed.transaction.message.staticAccountKeys;
  const landedMatch = matchingTransfers(o, transfersFromInner(landed.meta.innerInstructions, keys));
  const ataIndex = keys.findIndex((k) => k.equals(landedMatch.payToAta));
  const bal = (list: typeof landed.meta.preTokenBalances) =>
    BigInt(list?.find((b) => b.accountIndex === ataIndex)?.uiTokenAmount.amount ?? "0");
  const delta = bal(landed.meta.postTokenBalances) - bal(landed.meta.preTokenBalances);
  if (landedMatch.ok.length !== 1 || delta < o.amount) {
    throw new SponsorVerifyError("settlement_mismatch", `settled tx does not pay ${o.amount} to payTo (delta ${delta})`);
  }
  return { success: true, transaction: signature, network: SOLANA_DEVNET_CAIP2, payer: client.toBase58() };
}

/**
 * An x402 resource as a `fetch` implementation (usable in-process by `payX402`, or behind a route):
 * no PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED; valid payment → 200 + PAYMENT-RESPONSE + content;
 * invalid payment → 402 + PAYMENT-RESPONSE {success:false, errorReason}.
 */
export function sponsoredResourceFetch(o: SponsorOptions, resourceUrl: string): typeof fetch {
  const requirement = sponsorRequirement(o);
  const paymentRequired: PaymentRequired = {
    x402Version: X402_VERSION,
    error: "PAYMENT-SIGNATURE header is required",
    resource: { url: resourceUrl },
    accepts: [requirement],
  };
  return (async (_input: URL | RequestInfo, init?: RequestInit) => {
    const header = new Headers(init?.headers).get(HEADER_PAYMENT_SIGNATURE);
    if (!header) {
      return new Response(JSON.stringify(paymentRequired), {
        status: 402,
        headers: { [HEADER_PAYMENT_REQUIRED]: b64json(paymentRequired), "content-type": "application/json" },
      });
    }
    try {
      const payload = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
      if (payload.x402Version !== X402_VERSION || payload.accepted?.network !== SOLANA_DEVNET_CAIP2) {
        throw new SponsorVerifyError("invalid_payload", "unsupported payment payload");
      }
      const settlement = await verifyAndSettle(o, String(payload.payload?.transaction ?? ""));
      return new Response(JSON.stringify(o.content ?? { ok: true }), {
        status: 200,
        headers: { [HEADER_PAYMENT_RESPONSE]: b64json(settlement), "content-type": "application/json" },
      });
    } catch (e) {
      const errorReason = e instanceof SponsorVerifyError ? e.reason : "unexpected_error";
      return new Response(JSON.stringify({ error: (e as Error).message }), {
        status: 402,
        headers: { [HEADER_PAYMENT_RESPONSE]: b64json({ success: false, errorReason }) },
      });
    }
  }) as typeof fetch;
}
