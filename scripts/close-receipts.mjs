#!/usr/bin/env node
// F-02: close old PaymentReceipt accounts of a policy and refund their rent to the agent that
// paid it (docs/16 §1). The program only allows it once
// `now >= created_at + MAX_REQUEST_TTL_SECONDS + RECEIPT_CLOSE_GRACE_SECONDS`, so a closed
// request can never be replayed (it fails with RequestExpired).
//
// Run inside WSL with the policy OWNER key or the AGENT key recorded in the receipts:
//   node scripts/close-receipts.mjs --policy <address> [--keypair ~/.config/solana/id.json]
//        [--limit 10] [--dry-run] [--rpc <url>]
//
// Closing receipts removes the on-chain audit record (the transactions stay in RPC history,
// whose retention is limited). Opt-in only; --dry-run lists what would be closed.

import { devnetConnection, loadKeypair, log, parseArgs, require } from "./lib/common.mjs";

const { PublicKey, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const { AnchorProvider, Program } = require("@anchor-lang/core");
const idl = require("./src/lib/anchor/idl/agent_payment_firewall.json");

const args = parseArgs(process.argv.slice(2));
if (!args.policy) {
  console.error("usage: node scripts/close-receipts.mjs --policy <address> [--keypair <path>] [--limit N] [--dry-run]");
  process.exit(2);
}
const constant = (name) => Number(idl.constants.find((c) => c.name === name).value);
const TTL = constant("MAX_REQUEST_TTL_SECONDS");
const GRACE = constant("RECEIPT_CLOSE_GRACE_SECONDS");
const limit = Number(args.limit ?? 10);
const dryRun = args._flags.has("dry-run");

const signer = loadKeypair(args.keypair ?? "~/.config/solana/id.json");
const connection = await devnetConnection(args.rpc);
const readOnly = {
  publicKey: signer.publicKey,
  signTransaction: async () => {
    throw new Error("read-only");
  },
  signAllTransactions: async () => {
    throw new Error("read-only");
  },
};
const program = new Program(idl, new AnchorProvider(connection, readOnly, { commitment: "confirmed" }));
const policyAddress = new PublicKey(args.policy);
const policy = await program.account.agentPolicy.fetch(policyAddress);

const slot = await connection.getSlot("confirmed");
const now = await connection.getBlockTime(slot);
if (now === null) throw new Error("cluster time unavailable");

const receipts = await program.account.paymentReceipt.all([
  { memcmp: { offset: 8, bytes: policyAddress.toBase58() } },
]);
const isOwner = policy.owner.equals(signer.publicKey);
const eligible = receipts
  .filter((r) => now >= Number(r.account.createdAt) + TTL + GRACE)
  .filter((r) => isOwner || r.account.agent.equals(signer.publicKey))
  .sort((a, b) => Number(a.account.createdAt) - Number(b.account.createdAt))
  .slice(0, limit);

log("policy", policyAddress.toBase58());
log("signer", `${signer.publicKey.toBase58()} (${isOwner ? "owner" : "agent"})`);
log("receipts", `${receipts.length} total, ${eligible.length} closable now (limit ${limit})`);

let refunded = 0;
for (const r of eligible) {
  const lamports = (await connection.getBalance(r.publicKey, "confirmed")) ?? 0;
  const label = `${r.publicKey.toBase58()} created ${new Date(Number(r.account.createdAt) * 1000).toISOString()}`;
  if (dryRun) {
    log("would close", `${label} → ${lamports} lamports to ${r.account.agent.toBase58()}`);
    continue;
  }
  const ix = await program.methods
    .closeReceipt()
    .accountsStrict({
      closer: signer.publicKey,
      policy: policyAddress,
      receipt: r.publicKey,
      rentDestination: r.account.agent,
    })
    .instruction();
  const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [signer], {
    commitment: "confirmed",
  });
  refunded += lamports;
  log("closed", `${label} sig ${signature}`);
}
if (!dryRun) log("rent refunded (lamports)", refunded);
process.exit(0);
