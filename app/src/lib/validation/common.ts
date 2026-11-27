import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import { U64_MAX } from "@/lib/anchor/constants";

// Shared request/response schemas (docs/06 §2.1). JSON carries public keys as base58
// strings and token amounts as base-unit integer strings; logic converts with helpers.

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

function isValidPubkey(value: string): boolean {
  if (!BASE58.test(value) || value.length < 32 || value.length > 44) return false;
  try {
    return new PublicKey(value).toBytes().length === 32;
  } catch {
    return false;
  }
}

/** Base58 32-byte public key (any key: on-curve wallets and off-curve PDAs). */
export const PubkeySchema = z.string().refine(isValidPubkey, "invalid public key");

/** Positive u64 amount in base units, as a decimal string without sign or leading zeros. */
export const AmountSchema = z
  .string()
  .regex(/^[1-9][0-9]{0,19}$/, "amount must be a positive integer string in base units")
  // Zod 4 runs refinements even after a failed regex: re-check the shape before BigInt().
  .refine((s) => /^[0-9]+$/.test(s) && BigInt(s) <= U64_MAX, "amount exceeds u64");

/** 16-byte request id, lower-case hex. */
export const RequestIdSchema = z.string().regex(/^[0-9a-f]{32}$/, "requestId must be 32 lower-case hex chars");

/** 32-byte hash, lower-case hex. */
export const HashSchema = z.string().regex(/^[0-9a-f]{64}$/, "hash must be 64 lower-case hex chars");

/** Base58 transaction signature (64 bytes → 86–88 chars). */
export const SignatureSchema = z
  .string()
  .regex(BASE58, "signature must be base58")
  .refine((s) => s.length >= 86 && s.length <= 88, "invalid signature length");

export const PaymentStatusSchema = z.enum([
  "PENDING",
  "READY_TO_SIGN",
  "SUBMITTED",
  "CONFIRMED",
  "REJECTED",
  "FAILED",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const EvidenceSchema = z.enum(["ONCHAIN", "SIMULATION", "PRECHECK"]);
export type Evidence = z.infer<typeof EvidenceSchema>;

/** Route segment `[policyId]` carries the policy PDA ADDRESS (docs/06 naming note). */
export const PolicyRouteParamsSchema = z.object({ policyId: PubkeySchema });
