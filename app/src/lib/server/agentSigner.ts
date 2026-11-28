import "server-only";
import { createPrivateKey, createPublicKey, sign as edSign, verify as edVerify } from "node:crypto";
import { ComputeBudgetProgram, type Keypair, Message, PublicKey, type Transaction } from "@solana/web3.js";

/** SPL Memo program (x402 requires one Memo instruction per payment transaction). */
export const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
import { PROGRAM_ID } from "@/lib/anchor/constants";
import idl from "@/lib/anchor/idl/agent_payment_firewall.json";
import { base58Decode } from "@/lib/encoding/base58";

// F-04 (docs/16 §3): the agent key behind an interface so it can live in a KMS / MPC service
// instead of an env var. The program needs no change: it only checks that `policy.agent`
// signed. Every signer goes through `signAgentTransaction`, which runs the pre-sign guard
// first — a KMS signs any bytes it is given, so the guard is what limits it to
// `execute_payment` of this program.

export interface AgentSigner {
  readonly publicKey: PublicKey;
  readonly kind: "local" | "aws-kms";
  /** Pure Ed25519 signature (64 bytes) over the serialized transaction message. */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

/** A local Keypair (dev/demo custody) or a remote signer. */
export type AgentKey = Keypair | AgentSigner;

export class AgentSignerError extends Error {}
export class UnsafeAgentMessageError extends AgentSignerError {}

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const publicKeyObject = (pk: PublicKey) =>
  createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, pk.toBuffer()]), format: "der", type: "spki" });

/** True when `signature` is a valid Ed25519 signature of `message` by `pk`. */
export function verifyEd25519(pk: PublicKey, message: Uint8Array, signature: Uint8Array): boolean {
  if (signature.length !== 64) return false;
  try {
    return edVerify(null, Buffer.from(message), publicKeyObject(pk), Buffer.from(signature));
  } catch {
    return false;
  }
}

/** Wraps a Keypair in the signer interface (Node crypto Ed25519; same bytes as tx.sign). */
export function keypairSigner(kp: Keypair): AgentSigner {
  const key = createPrivateKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      d: Buffer.from(kp.secretKey.slice(0, 32)).toString("base64url"),
      x: kp.publicKey.toBuffer().toString("base64url"),
    },
    format: "jwk",
  });
  return {
    publicKey: kp.publicKey,
    kind: "local",
    sign: async (message) => new Uint8Array(edSign(null, Buffer.from(message), key)),
  };
}

export const isAgentSigner = (k: AgentKey): k is AgentSigner => typeof (k as AgentSigner).sign === "function";
export const toAgentSigner = (k: AgentKey): AgentSigner => (isAgentSigner(k) ? k : keypairSigner(k));

/** Minimal KMS client surface (AWS SDK `KMSClient.send(SignCommand)`), injectable for tests. */
export interface KmsSignClient {
  sign(input: { keyId: string; message: Uint8Array }): Promise<Uint8Array>;
}

/**
 * AWS KMS signer: key spec ECC_NIST_EDWARDS25519, algorithm ED25519_SHA_512, MessageType RAW
 * (pure EdDSA; NOT ED25519_PH_SHA_512). AWS does not document the Ed25519 output encoding, so
 * every signature is verified locally against the configured public key before use (KC-01).
 */
export function awsKmsSigner(opts: { keyId: string; publicKey: PublicKey; client: KmsSignClient }): AgentSigner {
  return {
    publicKey: opts.publicKey,
    kind: "aws-kms",
    async sign(message) {
      const sig = await opts.client.sign({ keyId: opts.keyId, message });
      if (!verifyEd25519(opts.publicKey, message, sig)) {
        throw new AgentSignerError(
          "KMS returned a signature that does not verify as a 64-byte Ed25519 signature for AGENT_PUBLIC_KEY",
        );
      }
      return sig;
    },
  };
}

/** Real AWS client, loaded lazily so local mode never imports the SDK. Credentials: SDK default chain. */
export function awsKmsClient(region: string | undefined): KmsSignClient {
  let client: Promise<{ send: (cmd: unknown) => Promise<{ Signature?: Uint8Array }> }> | undefined;
  let SignCommand: new (input: unknown) => unknown;
  return {
    async sign({ keyId, message }) {
      client ??= import("@aws-sdk/client-kms").then((m) => {
        SignCommand = m.SignCommand as unknown as typeof SignCommand;
        return new m.KMSClient(region ? { region } : {}) as never;
      });
      const c = await client;
      const out = await c.send(
        new SignCommand({ KeyId: keyId, Message: message, MessageType: "RAW", SigningAlgorithm: "ED25519_SHA_512" }),
      );
      if (!out.Signature) throw new AgentSignerError("KMS returned no signature");
      return out.Signature;
    },
  };
}

const EXECUTE_PAYMENT_DISCRIMINATOR = Uint8Array.from(
  idl.instructions.find((i) => i.name === "execute_payment")!.discriminator,
);

/**
 * Pre-sign guard (docs/16 §3.3): the message must be a legacy message whose fee payer is the
 * expected one, containing exactly one `execute_payment` of this program (plus optional
 * ComputeBudget instructions) and nothing else, with the agent as a signer.
 */
export function assertAgentMessageSafe(message: Uint8Array, expected: { agent: PublicKey; feePayer: PublicKey }) {
  let msg: Message;
  try {
    msg = Message.from(Buffer.from(message));
  } catch {
    throw new UnsafeAgentMessageError("not a legacy transaction message (versioned/ALT messages are refused)");
  }
  if (!msg.accountKeys[0]?.equals(expected.feePayer)) {
    throw new UnsafeAgentMessageError("unexpected fee payer");
  }
  const agentIndex = msg.accountKeys.findIndex((k) => k.equals(expected.agent));
  if (agentIndex < 0 || !msg.isAccountSigner(agentIndex)) {
    throw new UnsafeAgentMessageError("agent is not a signer of this message");
  }
  let payments = 0;
  for (const ix of msg.instructions) {
    const program = msg.accountKeys[ix.programIdIndex];
    if (program.equals(ComputeBudgetProgram.programId)) continue;
    // F-01 x402: an account-less Memo (payment reference) cannot move funds or use a signer.
    if (program.equals(MEMO_PROGRAM_ID)) {
      if (ix.accounts.length !== 0) throw new UnsafeAgentMessageError("memo instruction must not reference accounts");
      continue;
    }
    if (!program.equals(PROGRAM_ID)) {
      throw new UnsafeAgentMessageError(`instruction for a foreign program ${program.toBase58()}`);
    }
    const bytes = decodeIxData(ix.data);
    if (!startsWith(bytes, EXECUTE_PAYMENT_DISCRIMINATOR)) {
      throw new UnsafeAgentMessageError("only execute_payment may be signed by the agent");
    }
    payments++;
  }
  if (payments !== 1) throw new UnsafeAgentMessageError(`expected exactly one execute_payment, got ${payments}`);
}

/** Legacy `Message.instructions[].data` is base58. */
function decodeIxData(data: string): Uint8Array {
  try {
    return base58Decode(data);
  } catch {
    throw new UnsafeAgentMessageError("invalid instruction data encoding");
  }
}

const startsWith = (a: Uint8Array, prefix: Uint8Array) =>
  a.length >= prefix.length && prefix.every((b, i) => a[i] === b);

/**
 * Signs `tx` (fee payer + recent blockhash already set): guard → separate fee payer signs
 * (local key) → agent signs via its signer → `addSignature` (asserts 64 bytes, required signer).
 * `feePayer` may be an external sponsor's PUBLIC KEY (x402, F-01): then only the agent signs and
 * the sponsor adds its fee-payer signature later.
 */
export async function signAgentTransaction(tx: Transaction, agent: AgentKey, feePayer: Keypair | PublicKey | null) {
  const signer = toAgentSigner(agent);
  const payerKey = feePayer instanceof PublicKey ? feePayer : (feePayer?.publicKey ?? signer.publicKey);
  const message = tx.serializeMessage();
  assertAgentMessageSafe(message, { agent: signer.publicKey, feePayer: payerKey });
  if (feePayer && !(feePayer instanceof PublicKey) && !feePayer.publicKey.equals(signer.publicKey)) {
    tx.partialSign(feePayer);
  }
  const signature = await signer.sign(message);
  tx.addSignature(signer.publicKey, Buffer.from(signature));
}
