#!/usr/bin/env node
// Owner pauses or resumes a policy from the terminal (DEVNET). Stand-in for the Policy Details
// page until the wallet UI (T-M4-07/08) exists; the demo's "emergency pause" step uses it.
//
// Run inside WSL (the owner keypair must be the policy owner):
//   node scripts/policy-pause.mjs pause|resume --policy <policy address> [--keypair ~/.config/solana/id.json] [--rpc <url>]
//
// The program enforces owner-only access (`has_one = owner`): with any other key the
// transaction fails with UnauthorizedOwner. Prints the signature and the resulting flag.

import { devnetConnection, loadKeypair, log, parseArgs, require } from "./lib/common.mjs";

const { PublicKey, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const { AnchorProvider, Program } = require("@anchor-lang/core");
const idl = require("./src/lib/anchor/idl/agent_payment_firewall.json");

const action = process.argv[2];
if (action !== "pause" && action !== "resume") {
  console.error("usage: node scripts/policy-pause.mjs pause|resume --policy <address> [--keypair <path>]");
  process.exit(2);
}
const args = parseArgs(process.argv.slice(3));
if (!args.policy) throw new Error("--policy is required");
const owner = loadKeypair(args.keypair ?? "~/.config/solana/id.json");
const connection = await devnetConnection(args.rpc);

const readOnly = {
  publicKey: owner.publicKey,
  signTransaction: async () => {
    throw new Error("read-only");
  },
  signAllTransactions: async () => {
    throw new Error("read-only");
  },
};
const program = new Program(idl, new AnchorProvider(connection, readOnly, { commitment: "confirmed" }));
const policy = new PublicKey(args.policy);

const before = await program.account.agentPolicy.fetch(policy);
if (!before.owner.equals(owner.publicKey)) {
  throw new Error(`this keypair (${owner.publicKey.toBase58()}) is not the policy owner (${before.owner.toBase58()})`);
}
const builder = action === "pause" ? program.methods.pausePolicy() : program.methods.resumePolicy();
const ix = await builder.accountsStrict({ owner: owner.publicKey, policy }).instruction();
const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [owner], {
  commitment: "confirmed",
});
const after = await program.account.agentPolicy.fetch(policy);

log(`${action}_policy`, signature);
log("explorer", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
log("policy is now", after.isPaused ? "PAUSED" : "ACTIVE");
process.exit(0);
