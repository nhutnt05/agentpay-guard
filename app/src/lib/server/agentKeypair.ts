import "server-only";
import { Keypair, PublicKey } from "@solana/web3.js";
import { base58Decode } from "@/lib/encoding/base58";
import { type AgentKey, awsKmsClient, awsKmsSigner } from "./agentSigner";

// Server-side agent key (docs/06 §1.2). HACKATHON DEMO CUSTODY — not production key
// management. Rules: read only here; never logged, never returned, never in NEXT_PUBLIC_*.
// Error messages describe the problem without echoing any part of the secret.

export class AgentKeyConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentKeyConfigError";
  }
}

/**
 * Parses `AGENT_SECRET_KEY`: either the Solana CLI keypair JSON (array of 64 bytes) or a
 * base58-encoded 64-byte secret key.
 */
export function parseAgentSecretKey(raw: string | undefined): Keypair {
  return parseSecretKey(raw, "AGENT_SECRET_KEY");
}

/** Same rules for any server-only keypair variable (`name` appears in error messages). */
export function parseSecretKey(raw: string | undefined, name: string): Keypair {
  const value = raw?.trim();
  if (!value) throw new AgentKeyConfigError(`${name} is not set`);

  let bytes: Uint8Array;
  if (value.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new AgentKeyConfigError(`${name} is not valid JSON`);
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
    ) {
      throw new AgentKeyConfigError(`${name} JSON must be an array of bytes`);
    }
    bytes = Uint8Array.from(parsed as number[]);
  } else {
    try {
      bytes = base58Decode(value);
    } catch {
      throw new AgentKeyConfigError(`${name} is neither a JSON byte array nor base58`);
    }
  }

  if (bytes.length !== 64) {
    throw new AgentKeyConfigError(`${name} must decode to 64 bytes, got ${bytes.length}`);
  }
  try {
    // Validates that the public half matches the secret half. NOTE: web3.js keeps a
    // reference to `bytes` inside the Keypair, so the array must not be wiped here.
    return Keypair.fromSecretKey(bytes);
  } catch {
    throw new AgentKeyConfigError(`${name} is not a valid ed25519 keypair`);
  }
}

let cached: Keypair | undefined;

/** The server agent keypair. Throws `AgentKeyConfigError` if not configured. */
export function getAgentKeypair(): Keypair {
  cached ??= parseAgentSecretKey(process.env.AGENT_SECRET_KEY);
  return cached;
}

let cachedKey: AgentKey | undefined;

/**
 * The configured agent signer (F-04, docs/16 §3). `AGENT_SIGNER`:
 * - `local` (default): `AGENT_SECRET_KEY` in the environment (demo custody).
 * - `aws-kms`: `AWS_KMS_KEY_ID` (ECC_NIST_EDWARDS25519 key), `AGENT_PUBLIC_KEY` (base58 of the
 *   KMS public key; every KMS signature is verified against it), optional `AWS_REGION`.
 *   AWS credentials come from the SDK default chain; no secret key in this app.
 */
export function getAgentKey(): AgentKey {
  if (cachedKey) return cachedKey;
  const mode = (process.env.AGENT_SIGNER ?? "local").trim() || "local";
  if (mode === "local") {
    cachedKey = getAgentKeypair();
  } else if (mode === "aws-kms") {
    const keyId = process.env.AWS_KMS_KEY_ID?.trim();
    if (!keyId) throw new AgentKeyConfigError("AWS_KMS_KEY_ID is not set (AGENT_SIGNER=aws-kms)");
    let publicKey: PublicKey;
    try {
      publicKey = new PublicKey(process.env.AGENT_PUBLIC_KEY?.trim() ?? "");
    } catch {
      throw new AgentKeyConfigError("AGENT_PUBLIC_KEY must be the base58 public key of the KMS key");
    }
    cachedKey = awsKmsSigner({ keyId, publicKey, client: awsKmsClient(process.env.AWS_REGION?.trim()) });
  } else {
    throw new AgentKeyConfigError(`AGENT_SIGNER must be "local" or "aws-kms"`);
  }
  return cachedKey;
}

/** The agent public key, or null when the key is missing/invalid (for health checks). */
export function getAgentPublicKey(): PublicKey | null {
  try {
    return getAgentKey().publicKey;
  } catch {
    return null;
  }
}
