import "server-only";
import { Keypair, type PublicKey } from "@solana/web3.js";
import { base58Decode } from "@/lib/encoding/base58";

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
  const value = raw?.trim();
  if (!value) throw new AgentKeyConfigError("AGENT_SECRET_KEY is not set");

  let bytes: Uint8Array;
  if (value.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new AgentKeyConfigError("AGENT_SECRET_KEY is not valid JSON");
    }
    if (
      !Array.isArray(parsed) ||
      !parsed.every((b) => Number.isInteger(b) && b >= 0 && b <= 255)
    ) {
      throw new AgentKeyConfigError("AGENT_SECRET_KEY JSON must be an array of bytes");
    }
    bytes = Uint8Array.from(parsed as number[]);
  } else {
    try {
      bytes = base58Decode(value);
    } catch {
      throw new AgentKeyConfigError("AGENT_SECRET_KEY is neither a JSON byte array nor base58");
    }
  }

  if (bytes.length !== 64) {
    throw new AgentKeyConfigError(`AGENT_SECRET_KEY must decode to 64 bytes, got ${bytes.length}`);
  }
  try {
    // Validates that the public half matches the secret half. NOTE: web3.js keeps a
    // reference to `bytes` inside the Keypair, so the array must not be wiped here.
    return Keypair.fromSecretKey(bytes);
  } catch {
    throw new AgentKeyConfigError("AGENT_SECRET_KEY is not a valid ed25519 keypair");
  }
}

let cached: Keypair | undefined;

/** The server agent keypair. Throws `AgentKeyConfigError` if not configured. */
export function getAgentKeypair(): Keypair {
  cached ??= parseAgentSecretKey(process.env.AGENT_SECRET_KEY);
  return cached;
}

/** The agent public key, or null when the key is missing/invalid (for health checks). */
export function getAgentPublicKey(): PublicKey | null {
  try {
    return getAgentKeypair().publicKey;
  } catch {
    return null;
  }
}
