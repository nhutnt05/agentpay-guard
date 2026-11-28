import {
  ComputeBudgetProgram,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { PROGRAM_ID } from "@/lib/anchor/constants";
import idl from "@/lib/anchor/idl/agent_payment_firewall.json";
import {
  AgentSignerError,
  assertAgentMessageSafe,
  awsKmsSigner,
  type KmsSignClient,
  keypairSigner,
  signAgentTransaction,
  UnsafeAgentMessageError,
  verifyEd25519,
} from "./agentSigner";

// F-04 (docs/16 §3): signer interface, pre-sign guard and KMS signature checks. The "KMS" here
// is a fake client that signs with a local key — it proves the wiring and the verification,
// not AWS itself (KC-01/KC-02 against real AWS need an AWS account).

const BLOCKHASH = new PublicKey(new Uint8Array(32).fill(9)).toBase58();
const disc = (name: string) => Buffer.from(idl.instructions.find((i) => i.name === name)!.discriminator);

function programIx(agent: PublicKey, name = "execute_payment") {
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: agent, isSigner: true, isWritable: true }],
    data: Buffer.concat([disc(name), Buffer.alloc(64)]),
  });
}

function tx(feePayer: PublicKey, ...ixs: TransactionInstruction[]) {
  const t = new Transaction({ feePayer, blockhash: BLOCKHASH, lastValidBlockHeight: 1 });
  t.add(...ixs);
  return t;
}

/** Fake KMS backed by a local key; `tamper` simulates a wrong output format. */
function fakeKms(key: Keypair, tamper?: (sig: Uint8Array) => Uint8Array) {
  const local = keypairSigner(key);
  const sign = vi.fn(async ({ message }: { keyId: string; message: Uint8Array }) => {
    const sig = await local.sign(message);
    return tamper ? tamper(sig) : sig;
  });
  return { client: { sign } satisfies KmsSignClient, sign };
}

describe("agent signer (F-04)", () => {
  it("keypairSigner produces the same signature as Transaction.sign", async () => {
    const agent = Keypair.generate();
    const a = tx(agent.publicKey, programIx(agent.publicKey));
    const b = tx(agent.publicKey, programIx(agent.publicKey));
    a.sign(agent);
    await signAgentTransaction(b, agent, null);
    expect(b.signature).toEqual(a.signature);
    expect(b.verifySignatures()).toBe(true);
  });

  it("KC-01 (simulated): KMS signature verifies and the tx serializes with fee payer + agent", async () => {
    const agentKey = Keypair.generate();
    const feePayer = Keypair.generate();
    const kms = fakeKms(agentKey);
    const signer = awsKmsSigner({ keyId: "alias/agent", publicKey: agentKey.publicKey, client: kms.client });
    const t = tx(feePayer.publicKey, ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }), programIx(agentKey.publicKey));
    await signAgentTransaction(t, signer, feePayer);
    expect(kms.sign).toHaveBeenCalledWith(expect.objectContaining({ keyId: "alias/agent" }));
    expect(t.signatures.map((s) => s.publicKey.toBase58())).toEqual([
      feePayer.publicKey.toBase58(),
      agentKey.publicKey.toBase58(),
    ]);
    expect(() => t.serialize()).not.toThrow(); // verifies every signature
  });

  it("rejects a KMS signature in the wrong format or from another key", async () => {
    const agentKey = Keypair.generate();
    const wrongFormat = fakeKms(agentKey, (sig) => Uint8Array.from([0x30, ...sig])); // e.g. DER-wrapped
    const otherKey = fakeKms(Keypair.generate());
    for (const kms of [wrongFormat, otherKey]) {
      const signer = awsKmsSigner({ keyId: "k", publicKey: agentKey.publicKey, client: kms.client });
      await expect(signAgentTransaction(tx(agentKey.publicKey, programIx(agentKey.publicKey)), signer, null)).rejects.toThrow(
        AgentSignerError,
      );
    }
  });

  it("KC-03: the guard refuses anything but one execute_payment, before the KMS is called", async () => {
    const agentKey = Keypair.generate();
    const kms = fakeKms(agentKey);
    const signer = awsKmsSigner({ keyId: "k", publicKey: agentKey.publicKey, client: kms.client });
    const a = agentKey.publicKey;
    const drain = SystemProgram.transfer({ fromPubkey: a, toPubkey: Keypair.generate().publicKey, lamports: 1 });
    const foreign = new TransactionInstruction({
      programId: Keypair.generate().publicKey,
      keys: [{ pubkey: a, isSigner: true, isWritable: true }],
      data: disc("execute_payment"),
    });
    const cases: [string, Transaction][] = [
      ["system transfer added", tx(a, programIx(a), drain)],
      ["foreign program", tx(a, foreign)],
      ["other instruction of our program (withdraw)", tx(a, programIx(a, "withdraw"))],
      ["two payments", tx(a, programIx(a), programIx(a))],
      ["no payment", tx(a, ComputeBudgetProgram.setComputeUnitLimit({ units: 1 }))],
      ["unexpected fee payer", tx(Keypair.generate().publicKey, programIx(a))],
    ];
    for (const [label, t] of cases) {
      await expect(signAgentTransaction(t, signer, null), label).rejects.toThrow(UnsafeAgentMessageError);
    }
    expect(kms.sign).not.toHaveBeenCalled();
  });

  it("guard refuses non-legacy bytes", () => {
    const a = Keypair.generate().publicKey;
    expect(() => assertAgentMessageSafe(Uint8Array.from([0x80, 1, 2, 3]), { agent: a, feePayer: a })).toThrow(
      UnsafeAgentMessageError,
    );
  });

  it("verifyEd25519 rejects wrong length and wrong message", async () => {
    const k = Keypair.generate();
    const msg = Uint8Array.from([1, 2, 3]);
    const sig = await keypairSigner(k).sign(msg);
    expect(verifyEd25519(k.publicKey, msg, sig)).toBe(true);
    expect(verifyEd25519(k.publicKey, Uint8Array.from([1, 2, 4]), sig)).toBe(false);
    expect(verifyEd25519(k.publicKey, msg, sig.slice(0, 63))).toBe(false);
  });
});
