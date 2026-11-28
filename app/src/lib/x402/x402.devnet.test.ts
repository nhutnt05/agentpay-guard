import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { receiptPda } from "@/lib/anchor/pda";
import type { PaymentDeps } from "@/lib/server/payments";
import { payX402 } from "./client";
import { sponsoredResourceFetch } from "./sponsor";

// docs/14 §4 exit test (opt-in, LIVE devnet, spends real devnet tokens/SOL):
//   X402_E2E=1 AGENT_SECRET_KEY='[..]' X402_SPONSOR_SECRET_KEY='[..]' E2E_POLICY=<policy>
//   E2E_MERCHANT=<allowlisted wallet with an ATA> E2E_ATTACKER=<non-allowlisted wallet with an ATA>
//   [E2E_AMOUNT=1000000] [SOLANA_RPC_URL=...] pnpm exec vitest run src/lib/x402/x402.devnet.test.ts
// The x402 resource + self-hosted facilitator (sponsor.ts) runs in-process; everything on-chain is
// real: the agent signs execute_payment, the sponsor verifies (simulation with inner
// instructions), co-signs as fee payer, sends and re-checks; our client confirms tx + receipt.

const enabled = process.env.X402_E2E === "1";
const key = (name: string) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env[name] ?? "[]")));
const HOST = "x402.e2e.invalid";

describe.skipIf(!enabled)("x402 through the firewall on devnet (docs/14 §4)", () => {
  const connection = new Connection(process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const amount = BigInt(process.env.E2E_AMOUNT ?? "1000000");

  async function setup() {
    const agent = key("AGENT_SECRET_KEY");
    const sponsor = key("X402_SPONSOR_SECRET_KEY");
    const program = getReadonlyProgram(connection, agent.publicKey);
    const policy = new PublicKey(process.env.E2E_POLICY!);
    const account = await program.account.agentPolicy.fetch(policy);
    const deps: PaymentDeps = {
      rpc: connection,
      program,
      agent,
      allowedOwners: new Set([account.owner.toBase58()]),
      demoMode: false,
      confirmTimeoutMs: 60_000,
    };
    return { agent, sponsor, policy, mint: account.mint, deps };
  }

  const balance = async (owner: PublicKey, mint: PublicKey) =>
    BigInt((await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint, owner))).value.amount);

  it("allowlisted payTo: 402 → paid via execute_payment → sponsor settles → CONFIRMED with receipt", async () => {
    const { sponsor, policy, mint, deps } = await setup();
    const payTo = new PublicKey(process.env.E2E_MERCHANT!);
    const before = await balance(payTo, mint);
    const url = `https://${HOST}/premium`;
    const fetchImpl = sponsoredResourceFetch(
      { connection, sponsor, payTo, asset: mint, amount, memo: `e2e-${Date.now()}`, content: { premium: true } },
      url,
    );

    const r = await payX402(deps, { policy: policy.toBase58(), url }, { fetch: fetchImpl, allowedHosts: new Set([HOST]) });
    console.log("x402 allowlisted:", JSON.stringify({ status: r.status, signature: r.signature, receipt: r.receipt, x402: r.x402 }));
    expect(r.status).toBe("CONFIRMED");
    expect(r.x402?.settlement?.success).toBe(true);
    expect(r.x402?.serverStatus).toBe(200);

    const tx = await connection.getTransaction(r.signature!, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    expect(tx?.transaction.message.staticAccountKeys[0].equals(sponsor.publicKey)).toBe(true); // sponsor paid the fee
    const hash = r.preparedPayment!.requestHash;
    const receipt = receiptPda(policy, Buffer.from(hash, "hex"))[0];
    expect(await connection.getAccountInfo(receipt)).not.toBeNull();
    expect((await balance(payTo, mint)) - before).toBe(amount);
  }, 180_000);

  it("non-allowlisted payTo: the program refuses in simulation; nothing is signed, sent or settled", async () => {
    const { sponsor, policy, mint, deps } = await setup();
    const payTo = new PublicKey(process.env.E2E_ATTACKER!);
    const before = await balance(payTo, mint);
    const url = `https://${HOST}/premium`;
    let paidRetries = 0;
    const inner = sponsoredResourceFetch({ connection, sponsor, payTo, asset: mint, amount }, url);
    const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
      if (new Headers(init?.headers).has("PAYMENT-SIGNATURE")) paidRetries++;
      return inner(input, init);
    }) as typeof fetch;

    const r = await payX402(deps, { policy: policy.toBase58(), url }, { fetch: fetchImpl, allowedHosts: new Set([HOST]) });
    console.log("x402 attacker:", JSON.stringify({ status: r.status, reason: r.reason, evidence: r.evidence }));
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("MERCHANT_NOT_ALLOWLISTED");
    expect(paidRetries).toBe(0);
    expect(await balance(payTo, mint)).toBe(before);
  }, 120_000);
});
