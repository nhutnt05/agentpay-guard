import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, SEED_MERCHANT, SEED_POLICY, SEED_RECEIPT } from "./constants";

// Single source of PDA/ATA derivation for the app (docs/04 §6). Seeds and order must match
// the program exactly; `pda.test.ts` reproduces the cross-language vector in docs/04 §6.1.
// Browser-safe: uses Uint8Array seeds, no Node Buffer.

function assertLength(bytes: Uint8Array, length: number, what: string): void {
  if (bytes.length !== length) {
    throw new Error(`${what} must be ${length} bytes, got ${bytes.length}`);
  }
}

/** AgentPolicy PDA: [b"policy", owner, policy_id]. */
export function policyPda(
  owner: PublicKey,
  policyId: Uint8Array,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  assertLength(policyId, 32, "policy_id");
  return PublicKey.findProgramAddressSync([SEED_POLICY, owner.toBytes(), policyId], programId);
}

/** MerchantAllowlist PDA: [b"merchant", policy, merchant]. */
export function merchantAllowlistPda(
  policy: PublicKey,
  merchant: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [SEED_MERCHANT, policy.toBytes(), merchant.toBytes()],
    programId,
  );
}

/** PaymentReceipt PDA: [b"receipt", policy, request_hash]. */
export function receiptPda(
  policy: PublicKey,
  requestHash: Uint8Array,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  assertLength(requestHash, 32, "request_hash");
  return PublicKey.findProgramAddressSync([SEED_RECEIPT, policy.toBytes(), requestHash], programId);
}

/** Vault = ATA(owner = policy PDA, mint, classic Token program). The PDA is off-curve. */
export function vaultAddress(policy: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, policy, true, TOKEN_PROGRAM_ID);
}

/**
 * The merchant's ATA for the policy mint — the only token account `execute_payment`
 * accepts (ADR-022). Off-curve owners are allowed, mirroring the program's derivation.
 */
export function merchantTokenAccount(merchant: PublicKey, mint: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, merchant, true, TOKEN_PROGRAM_ID);
}
