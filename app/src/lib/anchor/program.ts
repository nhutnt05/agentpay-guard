import { AnchorProvider, Program } from "@anchor-lang/core";
import type { Connection, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { AgentPaymentFirewall } from "./idl/agent_payment_firewall";
import idl from "./idl/agent_payment_firewall.json";

export type AgentPaymentFirewallProgram = Program<AgentPaymentFirewall>;

/**
 * The signer interface AnchorProvider expects. (`Wallet` exported by @anchor-lang/core is the
 * NodeWallet CLASS, which requires a secret-key `payer` — never needed for reads.)
 */
export type ProviderWallet = ConstructorParameters<typeof AnchorProvider>[1];

/**
 * A wallet that can never sign. Used for read-only providers (account fetches, decoding,
 * instruction building). Any attempt to sign throws, so a read path can never send a
 * transaction by accident.
 */
export function readOnlyWallet(publicKey: PublicKey): ProviderWallet {
  const refuse = async (): Promise<never> => {
    throw new Error("read-only wallet cannot sign transactions");
  };
  return {
    publicKey,
    signTransaction: refuse as <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>,
    signAllTransactions: refuse as <T extends Transaction | VersionedTransaction>(
      txs: T[],
    ) => Promise<T[]>,
  };
}

/** Program client bound to `connection` and `wallet` (commitment: confirmed). */
export function getProgram(
  connection: Connection,
  wallet: ProviderWallet,
): AgentPaymentFirewallProgram {
  const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
  return new Program<AgentPaymentFirewall>(idl as AgentPaymentFirewall, provider);
}

/** Read-only program client (fetch/decode only). */
export function getReadonlyProgram(
  connection: Connection,
  payer: PublicKey,
): AgentPaymentFirewallProgram {
  return getProgram(connection, readOnlyWallet(payer));
}
