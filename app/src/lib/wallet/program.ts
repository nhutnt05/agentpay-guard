/**
 * Browser-safe program utilities for wallet transactions
 * Builds raw instructions without @anchor-lang/core to avoid Node.js dependencies
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { PROGRAM_ID } from '@/lib/anchor/constants';

/**
 * Get program account data
 * Simple helper without Anchor client dependencies
 */
export async function getPolicyAccount(connection: Connection, policyAddress: PublicKey) {
  const accountInfo = await connection.getAccountInfo(policyAddress);
  if (!accountInfo) {
    throw new Error('Policy account not found');
  }
  return accountInfo;
}

/**
 * Export program ID and connection helper
 */
export function getProgramId() {
  return PROGRAM_ID;
}
