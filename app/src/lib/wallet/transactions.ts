/**
 * Client-side transaction builders for wallet operations
 * These functions build instructions that must be signed by the wallet
 */

import { Program, BN } from '@coral-xyz/anchor';
import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { AgentPaymentFirewall } from '@/lib/anchor/idl/agent_payment_firewall';
import { policyPda, vaultAddress, merchantAllowlistPda } from '@/lib/anchor/pda';
import { MINT } from '@/lib/anchor/constants';

export interface BuildTransactionOptions {
  program: Program<AgentPaymentFirewall>;
  policyAddress: PublicKey;
  owner: PublicKey;
}

/**
 * Build initialize_policy instruction
 * @param program - Anchor program instance
 * @param owner - Policy owner public key (from wallet)
 * @param policyId - 32-byte policy ID
 * @param spendingLimit - Per-transaction limit in base units
 * @param dailyLimit - Daily spending limit in base units
 */
export async function buildInitializePolicy(
  program: Program<AgentPaymentFirewall>,
  owner: PublicKey,
  policyId: Uint8Array,
  spendingLimit: bigint,
  dailyLimit: bigint
): Promise<TransactionInstruction> {
  const [policyPDA] = policyPda(owner, policyId);
  const vaultATA = vaultAddress(policyPDA, MINT);

  return await program.methods
    .initializePolicy(Array.from(policyId), new BN(spendingLimit.toString()), new BN(dailyLimit.toString()))
    .accountsStrict({
      policy: policyPDA,
      vault: vaultATA,
      mint: MINT,
      owner,
      systemProgram: PublicKey.default,
      tokenProgram: PublicKey.default,
      associatedTokenProgram: PublicKey.default,
    })
    .instruction();
}

/**
 * Build pause_policy instruction
 */
export async function buildPausePolicy({
  program,
  policyAddress,
  owner,
}: BuildTransactionOptions): Promise<TransactionInstruction> {
  return await program.methods
    .pausePolicy()
    .accountsStrict({
      policy: policyAddress,
      owner,
    })
    .instruction();
}

/**
 * Build resume_policy instruction
 */
export async function buildResumePolicy({
  program,
  policyAddress,
  owner,
}: BuildTransactionOptions): Promise<TransactionInstruction> {
  return await program.methods
    .resumePolicy()
    .accountsStrict({
      policy: policyAddress,
      owner,
    })
    .instruction();
}

/**
 * Build update_policy instruction
 */
export async function buildUpdatePolicy(
  program: Program<AgentPaymentFirewall>,
  policyAddress: PublicKey,
  owner: PublicKey,
  spendingLimit: bigint,
  dailyLimit: bigint
): Promise<TransactionInstruction> {
  return await program.methods
    .updatePolicy(new BN(spendingLimit.toString()), new BN(dailyLimit.toString()))
    .accountsStrict({
      policy: policyAddress,
      owner,
    })
    .instruction();
}

/**
 * Build withdraw instruction
 */
export async function buildWithdraw(
  program: Program<AgentPaymentFirewall>,
  policyAddress: PublicKey,
  owner: PublicKey,
  amount: bigint
): Promise<TransactionInstruction> {
  const vaultATA = vaultAddress(policyAddress, MINT);

  return await program.methods
    .withdraw(new BN(amount.toString()))
    .accountsStrict({
      policy: policyAddress,
      vault: vaultATA,
      mint: MINT,
      owner,
      tokenProgram: PublicKey.default,
    })
    .instruction();
}

/**
 * Build add_merchant instruction
 */
export async function buildAddMerchant(
  program: Program<AgentPaymentFirewall>,
  policyAddress: PublicKey,
  owner: PublicKey,
  merchantAddress: PublicKey
): Promise<TransactionInstruction> {
  const [merchantPDA] = merchantAllowlistPda(policyAddress, merchantAddress);

  return await program.methods
    .addMerchant()
    .accountsStrict({
      policy: policyAddress,
      merchant: merchantPDA,
      merchantAddress,
      owner,
      systemProgram: PublicKey.default,
    })
    .instruction();
}

/**
 * Build remove_merchant instruction
 */
export async function buildRemoveMerchant(
  program: Program<AgentPaymentFirewall>,
  policyAddress: PublicKey,
  owner: PublicKey,
  merchantAddress: PublicKey
): Promise<TransactionInstruction> {
  const [merchantPDA] = merchantAllowlistPda(policyAddress, merchantAddress);

  return await program.methods
    .removeMerchant()
    .accountsStrict({
      policy: policyAddress,
      merchant: merchantPDA,
      merchantAddress,
      owner,
    })
    .instruction();
}
