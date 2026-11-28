import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, SEED_MERCHANT, SEED_MERCHANT_LIMIT, SEED_POLICY, SEED_RECEIPT, SEED_RULES } from "./constants";

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

/** F-03 SpendingRules PDA: [b"rules", policy]. Always passed to execute_payment. */
export function spendingRulesPda(policy: PublicKey, programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED_RULES, policy.toBytes()], programId);
}

/** F-03 MerchantLimit PDA: [b"merchant_limit", policy, merchant]. Always passed to execute_payment. */
export function merchantLimitPda(
  policy: PublicKey,
  merchant: PublicKey,
  programId: PublicKey = PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([SEED_MERCHANT_LIMIT, policy.toBytes(), merchant.toBytes()], programId);
}

/**
 * Vault = ATA(owner = policy PDA, mint, the mint's token program). The PDA is off-curve.
 * `tokenProgram` defaults to classic SPL Token; Token-2022 mints (F-05) pass its id.
 */
export function vaultAddress(
  policy: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  return getAssociatedTokenAddressSync(mint, policy, true, tokenProgram);
}

/**
 * F-05: the token program of a policy, inferred from its stored vault address (the vault is
 * the ATA for exactly one of the two token programs). No RPC call needed.
 */
export function tokenProgramForPolicy(policy: PublicKey, mint: PublicKey, vault: PublicKey): PublicKey {
  for (const program of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
    if (vaultAddress(policy, mint, program).equals(vault)) return program;
  }
  throw new Error("policy vault is not an ATA of the classic or Token-2022 program");
}

/**
 * The merchant's ATA for the policy mint — the only token account `execute_payment`
 * accepts (ADR-022). Off-curve owners are allowed, mirroring the program's derivation.
 */
export function merchantTokenAccount(
  merchant: PublicKey,
  mint: PublicKey,
  tokenProgram: PublicKey = TOKEN_PROGRAM_ID,
): PublicKey {
  return getAssociatedTokenAddressSync(mint, merchant, true, tokenProgram);
}
