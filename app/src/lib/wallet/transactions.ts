/**
 * Client-side transaction builders for wallet operations
 * Manual instruction building to avoid @anchor-lang/core Node.js dependencies
 * Uses raw instruction encoding per IDL spec
 */

import { BN } from 'bn.js';
import { sha256 } from 'js-sha256';
import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { policyPda, vaultAddress, merchantAllowlistPda } from '@/lib/anchor/pda';
import { MINT, PROGRAM_ID } from '@/lib/anchor/constants';

/**
 * Encode instruction discriminator (first 8 bytes of method name SHA256)
 * Anchor uses: sha256("global:<method_name>").slice(0, 8)
 */
function encodeDiscriminator(methodName: string): Buffer {
  const hash = sha256.array(`global:${methodName}`);
  return Buffer.from(hash.slice(0, 8));
}

/**
 * Build initialize_policy instruction
 */
export function buildInitializePolicy(
  owner: PublicKey,
  policyId: Uint8Array,
  agent: PublicKey,
  maxPerTx: bigint,
  dailyLimit: bigint
): TransactionInstruction {
  const [policyPDA] = policyPda(owner, policyId);
  const vaultATA = vaultAddress(policyPDA, MINT);

  // Encode instruction data: discriminator + policy_id + agent + max_per_tx + daily_limit
  // + accept_issuer_powers (bool, F-05; false = refuse Token-2022 mints with a permanent delegate)
  const discriminator = encodeDiscriminator('initialize_policy');
  const data = Buffer.alloc(8 + 32 + 32 + 8 + 8 + 1);

  discriminator.copy(data, 0);
  Buffer.from(policyId).copy(data, 8);
  agent.toBuffer().copy(data, 40);
  new BN(maxPerTx.toString()).toArrayLike(Buffer, 'le', 8).copy(data, 72);
  new BN(dailyLimit.toString()).toArrayLike(Buffer, 'le', 8).copy(data, 80);
  data.writeUInt8(0, 88);

  // Account order must match the program's `InitializePolicy` struct exactly.
  return new TransactionInstruction({
    keys: [
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: policyPDA, isSigner: false, isWritable: true },
      { pubkey: MINT, isSigner: false, isWritable: false },
      { pubkey: vaultATA, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build pause_policy instruction
 */
export function buildPausePolicy(
  policyAddress: PublicKey,
  owner: PublicKey
): TransactionInstruction {
  const discriminator = encodeDiscriminator('pause_policy');

  return new TransactionInstruction({
    keys: [
      { pubkey: policyAddress, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: discriminator,
  });
}

/**
 * Build resume_policy instruction
 */
export function buildResumePolicy(
  policyAddress: PublicKey,
  owner: PublicKey
): TransactionInstruction {
  const discriminator = encodeDiscriminator('resume_policy');

  return new TransactionInstruction({
    keys: [
      { pubkey: policyAddress, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: discriminator,
  });
}

/**
 * Build update_limits instruction
 */
export function buildUpdateLimits(
  policyAddress: PublicKey,
  owner: PublicKey,
  maxPerTx: bigint | null,
  dailyLimit: bigint | null
): TransactionInstruction {
  const discriminator = encodeDiscriminator('update_limits');
  
  // Encode: discriminator + Option<u64> maxPerTx + Option<u64> dailyLimit
  // Option encoding: 0 (None) or 1 (Some) followed by value
  const data = Buffer.alloc(8 + 1 + 8 + 1 + 8);
  discriminator.copy(data, 0);
  
  if (maxPerTx !== null) {
    data.writeUInt8(1, 8);
    new BN(maxPerTx.toString()).toArrayLike(Buffer, 'le', 8).copy(data, 9);
  } else {
    data.writeUInt8(0, 8);
  }
  
  if (dailyLimit !== null) {
    data.writeUInt8(1, 17);
    new BN(dailyLimit.toString()).toArrayLike(Buffer, 'le', 8).copy(data, 18);
  } else {
    data.writeUInt8(0, 17);
  }

  return new TransactionInstruction({
    keys: [
      { pubkey: policyAddress, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build withdraw_vault instruction
 */
export function buildWithdrawVault(
  policyAddress: PublicKey,
  owner: PublicKey,
  amount: bigint
): TransactionInstruction {
  const vaultATA = vaultAddress(policyAddress, MINT);
  const ownerATA = vaultAddress(owner, MINT);
  
  const discriminator = encodeDiscriminator('withdraw_vault');
  const data = Buffer.alloc(8 + 8);
  discriminator.copy(data, 0);
  new BN(amount.toString()).toArrayLike(Buffer, 'le', 8).copy(data, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: policyAddress, isSigner: false, isWritable: false },
      { pubkey: vaultATA, isSigner: false, isWritable: true },
      { pubkey: ownerATA, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build add_merchant instruction
 */
export function buildAddMerchant(
  policyAddress: PublicKey,
  owner: PublicKey,
  merchant: PublicKey
): TransactionInstruction {
  const [merchantAllowlist] = merchantAllowlistPda(policyAddress, merchant);
  
  const discriminator = encodeDiscriminator('add_merchant');
  const data = Buffer.alloc(8 + 32);
  discriminator.copy(data, 0);
  merchant.toBuffer().copy(data, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: policyAddress, isSigner: false, isWritable: false },
      { pubkey: merchantAllowlist, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}

/**
 * Build remove_merchant instruction
 */
export function buildRemoveMerchant(
  policyAddress: PublicKey,
  owner: PublicKey,
  merchant: PublicKey
): TransactionInstruction {
  const [merchantAllowlist] = merchantAllowlistPda(policyAddress, merchant);
  
  const discriminator = encodeDiscriminator('remove_merchant');
  const data = Buffer.alloc(8 + 32);
  discriminator.copy(data, 0);
  merchant.toBuffer().copy(data, 8);

  return new TransactionInstruction({
    keys: [
      { pubkey: merchantAllowlist, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data,
  });
}
