import "server-only";
import type { Keypair } from "@solana/web3.js";
import { parseSecretKey } from "./agentKeypair";

// Optional separate fee payer for agent transactions (T-M4-19, docs/05 §4 "Signers").
// When FEE_PAYER_SECRET_KEY is set, it pays the TRANSACTION FEE; the agent still signs
// `execute_payment` (the only spending authority) and still pays the receipt rent
// (`payer = agent` in the program). The fee payer has no authority in the program.
// Same custody rules as the agent key: server-only, never logged, never returned.

let cached: Keypair | null | undefined;

/** The fee payer keypair, or null when not configured. Throws on an invalid value. */
export function getFeePayerKeypair(): Keypair | null {
  if (cached !== undefined) return cached;
  const raw = process.env.FEE_PAYER_SECRET_KEY;
  cached = raw?.trim() ? parseSecretKey(raw, "FEE_PAYER_SECRET_KEY") : null;
  return cached;
}

/** Public key for health checks; null when unset or invalid. */
export function getFeePayerPublicKey() {
  try {
    return getFeePayerKeypair()?.publicKey ?? null;
  } catch {
    return null;
  }
}
