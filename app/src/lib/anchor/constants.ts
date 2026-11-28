import { PublicKey } from "@solana/web3.js";
import idl from "./idl/agent_payment_firewall.json";

// Mirrors anchor/programs/agent_payment_firewall/src/constants.rs. `constants.test.ts`
// checks every value against the `constants` section of the synced IDL.

/** Program id, taken from the synced IDL (the IDL address is validated by scripts/sync-idl.mjs). */
export const PROGRAM_ID = new PublicKey(idl.address);

/** SPL Token mint for demo (from NEXT_PUBLIC_DEMO_MINT env variable, defaults to wrapped SOL) */
const demoMint = process.env.NEXT_PUBLIC_DEMO_MINT?.trim();
const isValidMint = demoMint && demoMint.length > 0 && !demoMint.startsWith('<');
export const MINT = new PublicKey(
  isValidMint
    ? demoMint
    : "So11111111111111111111111111111111111111112" // Wrapped SOL
);

/** Mint decimals (default 9 for wrapped SOL, should match actual mint) */
export const MINT_DECIMALS = isValidMint ? 6 : 9;

const ascii = (s: string) => new TextEncoder().encode(s);

export const SEED_POLICY = ascii("policy");
export const SEED_MERCHANT = ascii("merchant");
export const SEED_RECEIPT = ascii("receipt");

/** Domain separator of the canonical request hash (docs/11 §3). 25 bytes. */
export const REQUEST_HASH_DOMAIN = ascii("AGENTPAY_GUARD_PAYMENT_V1");

export const SECONDS_PER_DAY = 86_400;
export const MAX_REQUEST_TTL_SECONDS = 600;

export const U64_MAX = 18_446_744_073_709_551_615n;
export const I64_MIN = -9_223_372_036_854_775_808n;
export const I64_MAX = 9_223_372_036_854_775_807n;

/**
 * Compares the configured `NEXT_PUBLIC_PROGRAM_ID` with the IDL address.
 * A mismatch means the app would talk to a different program than its IDL describes.
 */
export function checkProgramIdConfig(configured = process.env.NEXT_PUBLIC_PROGRAM_ID): {
  ok: boolean;
  idlProgramId: string;
  configuredProgramId: string | null;
} {
  return {
    ok: configured === idl.address,
    idlProgramId: idl.address,
    configuredProgramId: configured ?? null,
  };
}
