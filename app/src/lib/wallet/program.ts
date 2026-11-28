/**
 * Browser-safe program initialization for wallet transactions
 */

import { Connection } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { AgentPaymentFirewall } from '@/lib/anchor/idl/agent_payment_firewall';
import idl from '@/lib/anchor/idl/agent_payment_firewall.json';
import { PROGRAM_ID } from '@/lib/anchor/constants';

/**
 * Get a browser-safe Anchor program instance
 * Does not require a provider/wallet to be set up
 * Used for building instructions that will be signed by the browser wallet
 */
export function getBrowserProgram(connection: Connection): Program<AgentPaymentFirewall> {
  return new Program(
    idl as any,
    PROGRAM_ID,
    { connection }
  );
}
