import "server-only";
import { getMint } from "@solana/spl-token";
import type { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/anchor/constants";
import { merchantTokenAccount } from "@/lib/anchor/pda";
import { loadPolicy } from "@/lib/policy/read";
import { getPaymentDeps } from "@/lib/server/paymentDeps";
import { preparePayment, submitPayment } from "@/lib/server/payments";
import { getServerConnection } from "@/lib/solana/connection";
import type { DemoDeps, DemoState } from "./demo";
import { firecrawlScrape } from "./firecrawl";

/** Production dependencies for the demo route; payments go through the normal service. */
export function getDemoDeps(request?: Request): DemoDeps {
  const payment = getPaymentDeps(request);
  const connection = getServerConnection();

  const policyOrThrow = async (policy: PublicKey) => {
    const lookup = await loadPolicy(connection, payment.program, policy);
    if (lookup.kind !== "found") throw new Error("policy not found");
    return lookup.policy;
  };
  /** Token balance in base units, or null when the token account does not exist. */
  const tokenBalance = async (account: PublicKey): Promise<string | null> => {
    if (!(await connection.getAccountInfo(account, "confirmed"))) return null;
    return (await connection.getTokenAccountBalance(account, "confirmed")).value.amount;
  };

  return {
    demoMode: process.env.DEMO_MODE === "true",
    attackerWallet: process.env.DEMO_ATTACKER_WALLET,
    maliciousUrl: process.env.DEMO_MALICIOUS_URL,
    scrape: firecrawlScrape,
    getDecimals: async (policy) => (await getMint(connection, (await policyOrThrow(policy)).mint, "confirmed")).decimals,
    readState: async (policy, attacker): Promise<DemoState> => {
      const p = await policyOrThrow(policy);
      return {
        vaultBalance: await tokenBalance(p.vault),
        spentToday: p.spentToday.toString(),
        attackerBalance: await tokenBalance(merchantTokenAccount(attacker, p.mint)),
      };
    },
    receiptExists: async (receipt) => {
      const info = await connection.getAccountInfo(receipt, "confirmed");
      return Boolean(info && info.owner.equals(PROGRAM_ID));
    },
    prepare: (input) => preparePayment(payment, input),
    submit: (input) => submitPayment(payment, input),
  };
}
