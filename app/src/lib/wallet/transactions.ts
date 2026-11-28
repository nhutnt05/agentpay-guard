/**
 * Transaction builders for owner actions (pause/resume/update/withdraw/add_merchant/remove_merchant).
 * These are built client-side and signed by the owner's wallet.
 */

import { BN, type Program } from "@anchor-lang/core";
import { PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { AgentPaymentFirewall } from "@/lib/anchor/idl/agent_payment_firewall";
import { merchantAllowlistPda, policyPda, vaultAddress } from "@/lib/anchor/pda";

export interface BuildPausePolicyParams {
  program: Program<AgentPaymentFirewall>;
  owner: PublicKey;
  policyId: Uint8Array;
}

export async function buildPausePolicy({
  program,
  owner,
  policyId,
}: BuildPausePolicyParams): Promise<Transaction> {
  const [policy] = policyPda(owner, policyId);

  const ix = await program.methods
    .pausePolicy()
    .accountsStrict({
      owner,
      policy,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  return tx;
}

export interface BuildResumePolicyParams {
  program: Program<AgentPaymentFirewall>;
  owner: PublicKey;
  policyId: Uint8Array;
}

export async function buildResumePolicy({
  program,
  owner,
  policyId,
}: BuildResumePolicyParams): Promise<Transaction> {
  const [policy] = policyPda(owner, policyId);

  const ix = await program.methods
    .resumePolicy()
    .accountsStrict({
      owner,
      policy,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  return tx;
}

export interface BuildUpdatePolicyParams {
  program: Program<AgentPaymentFirewall>;
  owner: PublicKey;
  policyId: Uint8Array;
  newAgent?: PublicKey;
  newMaxPerTx?: bigint;
  newDailyLimit?: bigint;
}

export async function buildUpdatePolicy({
  program,
  owner,
  policyId,
  newAgent,
  newMaxPerTx,
  newDailyLimit,
}: BuildUpdatePolicyParams): Promise<Transaction> {
  const [policy] = policyPda(owner, policyId);

  // Convert optional values to the format Anchor expects (Some/None via null)
  const ix = await program.methods
    .updatePolicy(
      newAgent ?? null,
      newMaxPerTx !== undefined ? new BN(newMaxPerTx.toString()) : null,
      newDailyLimit !== undefined ? new BN(newDailyLimit.toString()) : null
    )
    .accountsStrict({
      owner,
      policy,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  return tx;
}

export interface BuildWithdrawParams {
  program: Program<AgentPaymentFirewall>;
  owner: PublicKey;
  policyId: Uint8Array;
  mint: PublicKey;
  amount: bigint;
}

export async function buildWithdraw({
  program,
  owner,
  policyId,
  mint,
  amount,
}: BuildWithdrawParams): Promise<Transaction> {
  const [policy] = policyPda(owner, policyId);
  const vault = vaultAddress(policy, mint);
  const destination = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID);

  const ix = await program.methods
    .withdraw(new BN(amount.toString()))
    .accountsStrict({
      owner,
      policy,
      mint,
      vault,
      destination,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  return tx;
}

export interface BuildAddMerchantParams {
  program: Program<AgentPaymentFirewall>;
  owner: PublicKey;
  policyId: Uint8Array;
  policyAddress: PublicKey;
  merchant: PublicKey;
}

export async function buildAddMerchant({
  program,
  owner,
  policyId,
  policyAddress,
  merchant,
}: BuildAddMerchantParams): Promise<Transaction> {
  const [merchantAllowlist] = merchantAllowlistPda(policyAddress, merchant);

  const ix = await program.methods
    .addMerchant()
    .accountsStrict({
      owner,
      policy: policyAddress,
      merchant,
      merchantAllowlist,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  return tx;
}

export interface BuildRemoveMerchantParams {
  program: Program<AgentPaymentFirewall>;
  owner: PublicKey;
  policyAddress: PublicKey;
  merchant: PublicKey;
}

export async function buildRemoveMerchant({
  program,
  owner,
  policyAddress,
  merchant,
}: BuildRemoveMerchantParams): Promise<Transaction> {
  const [merchantAllowlist] = merchantAllowlistPda(policyAddress, merchant);

  const ix = await program.methods
    .removeMerchant()
    .accountsStrict({
      owner,
      policy: policyAddress,
      merchant,
      merchantAllowlist,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  return tx;
}
