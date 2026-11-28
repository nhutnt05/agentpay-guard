import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { type Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { PROGRAM_ID } from "@/lib/anchor/constants";
import { MEMO_PROGRAM_ID } from "@/lib/server/agentSigner";
import { type SponsorOptions, SponsorVerifyError, verifyAndSettle, verifyPaymentTransaction } from "./sponsor";

// F-01 sponsor side (docs/14 design B): the self-hosted facilitator checks of the x402 SVM spec.

const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const b58 = (bytes: Uint8Array) => {
  let n = BigInt("0x" + (Buffer.from(bytes).toString("hex") || "0"));
  let s = "";
  while (n > 0n) {
    s = BASE58[Number(n % 58n)] + s;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    s = "1" + s;
  }
  return s;
};

const sponsor = Keypair.generate();
const agent = Keypair.generate();
const payTo = Keypair.generate().publicKey;
const asset = Keypair.generate().publicKey;
const vault = Keypair.generate().publicKey;
const payToAta = getAssociatedTokenAddressSync(asset, payTo, false, TOKEN);
const BLOCKHASH = new PublicKey(new Uint8Array(32).fill(9)).toBase58();

function options(connection: Partial<Connection> = {}): SponsorOptions {
  return { connection: connection as Connection, sponsor, payTo, asset, amount: 2_000_000n, memo: "inv_1", confirmTimeoutMs: 2_000 };
}

function clientTx(o: { feePayer?: PublicKey; extraIx?: TransactionInstruction; memo?: string; sign?: Keypair[] } = {}) {
  const tx = new Transaction({ feePayer: o.feePayer ?? sponsor.publicKey, blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: agent.publicKey, isSigner: true, isWritable: true },
        { pubkey: vault, isSigner: false, isWritable: true },
        { pubkey: payToAta, isSigner: false, isWritable: true },
        { pubkey: asset, isSigner: false, isWritable: false },
        { pubkey: TOKEN, isSigner: false, isWritable: false },
      ],
      data: Buffer.from([1, 2, 3]),
    }),
  );
  if (o.extraIx) tx.add(o.extraIx);
  tx.add(new TransactionInstruction({ programId: MEMO_PROGRAM_ID, keys: [], data: Buffer.from(o.memo ?? "inv_1") }));
  const signers = o.sign ?? [agent];
  if (signers.length > 0) tx.partialSign(...signers);
  else tx.setSigners(sponsor.publicKey, agent.publicKey); // agent slot left unsigned
  return tx;
}

const reason = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e instanceof SponsorVerifyError ? e.reason : `other: ${(e as Error).message}`;
  }
  return "ok";
};

describe("x402 sponsor: static checks (SVM spec §2.1, §3)", () => {
  it("accepts the client's partially signed execute_payment transaction", () => {
    expect(reason(() => verifyPaymentTransaction(options(), clientTx()))).toBe("ok");
  });

  it("rejects a wrong fee payer, sponsor in an instruction, foreign programs and wrong memo", () => {
    expect(reason(() => verifyPaymentTransaction(options(), clientTx({ feePayer: agent.publicKey })))).toBe("invalid_fee_payer");
    const sponsorIx = new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [{ pubkey: sponsor.publicKey, isSigner: false, isWritable: true }],
      data: Buffer.from("x"),
    });
    expect(reason(() => verifyPaymentTransaction(options(), clientTx({ extraIx: sponsorIx })))).toBe("fee_payer_in_instruction");
    const foreign = new TransactionInstruction({ programId: TOKEN, keys: [], data: Buffer.from([12]) });
    expect(reason(() => verifyPaymentTransaction(options(), clientTx({ extraIx: foreign })))).toBe("smart_wallet_program_not_allowed");
    expect(reason(() => verifyPaymentTransaction(options(), clientTx({ memo: "other" })))).toBe("invalid_memo");
  });

  it("rejects missing or tampered client signatures", () => {
    const unsigned = clientTx({ sign: [] as Keypair[] });
    expect(reason(() => verifyPaymentTransaction(options(), unsigned))).toBe("invalid_signers");
    const tampered = clientTx();
    tampered.instructions[0].data = Buffer.from([9, 9, 9]);
    expect(reason(() => verifyPaymentTransaction(options(), tampered))).toBe("invalid_signature");
  });
});

function transferCheckedInner(tx: Transaction, destination: PublicKey, amount: bigint) {
  const keys = tx.compileMessage().accountKeys;
  const idx = (k: PublicKey) => keys.findIndex((x) => x.equals(k));
  const data = Buffer.alloc(10);
  data[0] = 12;
  data.writeBigUInt64LE(amount, 1);
  data[9] = 6;
  return [{ index: 0, instructions: [{ programIdIndex: idx(TOKEN), accounts: [idx(vault), idx(asset), idx(destination)], data: b58(data) }] }];
}

function rpc(tx: Transaction, destination: PublicKey, amount: bigint, sent: string[]) {
  const inner = transferCheckedInner(tx, destination, amount);
  const keys = tx.compileMessage().accountKeys;
  return {
    simulateTransaction: async () => ({ value: { err: null, logs: [], innerInstructions: inner } }),
    sendRawTransaction: async () => {
      sent.push("sig");
      return "5uCXVGHUYpCgPBW4qJfyKsaUGov3E12avRn6YzBFQa7CTGPnV1fEAAUgfisvBjHvDQzC31Gdrn6sChPFGSz3Jih8";
    },
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: "confirmed", err: null }] }),
    getTransaction: async () => ({
      transaction: { message: { staticAccountKeys: keys } },
      meta: {
        innerInstructions: inner,
        preTokenBalances: [{ accountIndex: keys.findIndex((k) => k.equals(payToAta)), uiTokenAmount: { amount: "0" } }],
        postTokenBalances: [{ accountIndex: keys.findIndex((k) => k.equals(payToAta)), uiTokenAmount: { amount: amount.toString() } }],
      },
    }),
  } as unknown as Connection;
}

describe("x402 sponsor: simulation, settlement and re-check (spec §1.4, Path 2)", () => {
  it("settles when the inner TransferChecked pays the payTo ATA; sponsor co-signs", async () => {
    const tx = clientTx();
    const sent: string[] = [];
    const s = await verifyAndSettle({ ...options(), connection: rpc(tx, payToAta, 2_000_000n, sent) }, tx.serialize({ requireAllSignatures: false }).toString("base64"));
    expect(s).toMatchObject({ success: true, payer: agent.publicKey.toBase58() });
    expect(sent).toHaveLength(1);
  });

  it("refuses (nothing sent) when the transfer goes elsewhere or is too small", async () => {
    const tx = clientTx();
    const sent: string[] = [];
    await expect(
      verifyAndSettle({ ...options(), connection: rpc(tx, vault, 2_000_000n, sent) }, tx.serialize({ requireAllSignatures: false }).toString("base64")),
    ).rejects.toMatchObject({ reason: "invalid_transfer" });
    await expect(
      verifyAndSettle({ ...options(), connection: rpc(tx, payToAta, 1n, sent) }, tx.serialize({ requireAllSignatures: false }).toString("base64")),
    ).rejects.toMatchObject({ reason: "invalid_transfer" });
    expect(sent).toHaveLength(0);
  });
});
