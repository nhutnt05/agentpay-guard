/**
 * Transaction builders for owner actions, signed by the owner's browser wallet.
 *
 * Merge of `frontend` (policy pages) and `main` (dashboard): every instruction is built with the
 * Anchor client from the synced IDL (`accountsStrict`), so account order, discriminators and
 * argument encoding always match the program. The earlier hand-encoded builders sent wrong
 * account orders and non-existent instructions (`update_limits`, `withdraw_vault`).
 *
 * - Object-parameter builders (`buildPausePolicy({ program, ... })`, …) return a Transaction
 *   and are used by the dashboard (`PolicyDetailsContent`).
 * - `buildInitializePolicy` and the `*Ix` helpers take positional arguments and return one
 *   instruction for the policy pages (`CreatePolicyForm`, `MerchantsManager`, `PolicyDetails`).
 */

import { BN, type Program } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, PublicKey, SystemProgram, Transaction, type TransactionInstruction } from "@solana/web3.js";
import { MINT } from "@/lib/anchor/constants";
import type { AgentPaymentFirewall } from "@/lib/anchor/idl/agent_payment_firewall";
import { merchantAllowlistPda, policyPda, vaultAddress } from "@/lib/anchor/pda";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { getPublicRpcUrl } from "@/lib/solana/connection";

// ---------------------------------------------------------------- dashboard (object params)

export interface BuildPausePolicyParams {
  program: Program<AgentPaymentFirewall>;
  owner: PublicKey;
  policyId: Uint8Array;
}

export async function buildPausePolicy({ program, owner, policyId }: BuildPausePolicyParams): Promise<Transaction> {
  const [policy] = policyPda(owner, policyId);
  const ix = await program.methods.pausePolicy().accountsStrict({ owner, policy }).instruction();
  return new Transaction().add(ix);
}

export interface BuildResumePolicyParams {
  program: Program<AgentPaymentFirewall>;
  owner: PublicKey;
  policyId: Uint8Array;
}

export async function buildResumePolicy({ program, owner, policyId }: BuildResumePolicyParams): Promise<Transaction> {
  const [policy] = policyPda(owner, policyId);
  const ix = await program.methods.resumePolicy().accountsStrict({ owner, policy }).instruction();
  return new Transaction().add(ix);
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
  // Program signature: update_policy(new_max_per_tx, new_daily_limit, new_agent); null = None.
  const ix = await program.methods
    .updatePolicy(
      newMaxPerTx !== undefined ? new BN(newMaxPerTx.toString()) : null,
      newDailyLimit !== undefined ? new BN(newDailyLimit.toString()) : null,
      newAgent ?? null,
    )
    .accountsStrict({ owner, policy })
    .instruction();
  return new Transaction().add(ix);
}

export interface BuildWithdrawParams {
  program: Program<AgentPaymentFirewall>;
  owner: PublicKey;
  policyId: Uint8Array;
  mint: PublicKey;
  amount: bigint;
}

export async function buildWithdraw({ program, owner, policyId, mint, amount }: BuildWithdrawParams): Promise<Transaction> {
  const [policy] = policyPda(owner, policyId);
  const ix = await withdrawInstruction(program, owner, policy, mint, amount);
  return new Transaction().add(ix);
}

export interface BuildAddMerchantParams {
  program: Program<AgentPaymentFirewall>;
  owner: PublicKey;
  policyId: Uint8Array;
  policyAddress: PublicKey;
  merchant: PublicKey;
}

export async function buildAddMerchant({ program, owner, policyAddress, merchant }: BuildAddMerchantParams): Promise<Transaction> {
  return new Transaction().add(await addMerchantInstruction(program, owner, policyAddress, merchant));
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
  return new Transaction().add(await removeMerchantInstruction(program, owner, policyAddress, merchant));
}

// ---------------------------------------------------------------- shared instruction builders

async function withdrawInstruction(
  program: Program<AgentPaymentFirewall>,
  owner: PublicKey,
  policy: PublicKey,
  mint: PublicKey,
  amount: bigint,
): Promise<TransactionInstruction> {
  return program.methods
    .withdraw(new BN(amount.toString()))
    .accountsStrict({
      owner,
      policy,
      mint,
      vault: vaultAddress(policy, mint),
      destination: getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID),
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();
}

async function addMerchantInstruction(
  program: Program<AgentPaymentFirewall>,
  owner: PublicKey,
  policy: PublicKey,
  merchant: PublicKey,
): Promise<TransactionInstruction> {
  return program.methods
    .addMerchant()
    .accountsStrict({
      owner,
      policy,
      merchant,
      merchantAllowlist: merchantAllowlistPda(policy, merchant)[0],
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

async function removeMerchantInstruction(
  program: Program<AgentPaymentFirewall>,
  owner: PublicKey,
  policy: PublicKey,
  merchant: PublicKey,
): Promise<TransactionInstruction> {
  return program.methods
    .removeMerchant()
    .accountsStrict({ owner, policy, merchant, merchantAllowlist: merchantAllowlistPda(policy, merchant)[0] })
    .instruction();
}

// ---------------------------------------------------------------- policy pages (positional)

/** Instruction-building program for the policy pages (no RPC calls are made, nothing signs). */
function pageProgram(owner: PublicKey): Program<AgentPaymentFirewall> {
  return getReadonlyProgram(new Connection(getPublicRpcUrl()), owner);
}

/**
 * initialize_policy for the configured demo mint (classic SPL Token).
 * `acceptIssuerPowers` (F-05) only matters for Token-2022 mints with issuer powers (PermanentDelegate or,
 * since 2026-11-28, MintCloseAuthority); the UI always sends false, so such mints are refused.
 */
export async function buildInitializePolicy(
  owner: PublicKey,
  policyId: Uint8Array,
  agent: PublicKey,
  maxPerTx: bigint,
  dailyLimit: bigint,
  acceptIssuerPowers = false,
): Promise<TransactionInstruction> {
  const [policy] = policyPda(owner, policyId);
  return pageProgram(owner)
    .methods.initializePolicy(
      Array.from(policyId),
      agent,
      new BN(maxPerTx.toString()),
      new BN(dailyLimit.toString()),
      acceptIssuerPowers,
    )
    .accountsStrict({
      owner,
      policy,
      mint: MINT,
      vault: vaultAddress(policy, MINT),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

export async function pausePolicyIx(policyAddress: PublicKey, owner: PublicKey): Promise<TransactionInstruction> {
  return pageProgram(owner).methods.pausePolicy().accountsStrict({ owner, policy: policyAddress }).instruction();
}

export async function resumePolicyIx(policyAddress: PublicKey, owner: PublicKey): Promise<TransactionInstruction> {
  return pageProgram(owner).methods.resumePolicy().accountsStrict({ owner, policy: policyAddress }).instruction();
}

/** update_policy with only limits (null = unchanged). */
export async function updateLimitsIx(
  policyAddress: PublicKey,
  owner: PublicKey,
  maxPerTx: bigint | null,
  dailyLimit: bigint | null,
): Promise<TransactionInstruction> {
  return pageProgram(owner)
    .methods.updatePolicy(
      maxPerTx === null ? null : new BN(maxPerTx.toString()),
      dailyLimit === null ? null : new BN(dailyLimit.toString()),
      null,
    )
    .accountsStrict({ owner, policy: policyAddress })
    .instruction();
}

/** withdraw from the vault to the owner's ATA of the configured mint. */
export async function withdrawVaultIx(
  policyAddress: PublicKey,
  owner: PublicKey,
  amount: bigint,
): Promise<TransactionInstruction> {
  return withdrawInstruction(pageProgram(owner), owner, policyAddress, MINT, amount);
}

export async function addMerchantIx(
  policyAddress: PublicKey,
  owner: PublicKey,
  merchant: PublicKey,
): Promise<TransactionInstruction> {
  return addMerchantInstruction(pageProgram(owner), owner, policyAddress, merchant);
}

export async function removeMerchantIx(
  policyAddress: PublicKey,
  owner: PublicKey,
  merchant: PublicKey,
): Promise<TransactionInstruction> {
  return removeMerchantInstruction(pageProgram(owner), owner, policyAddress, merchant);
}
