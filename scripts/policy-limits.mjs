#!/usr/bin/env node
// F-03 owner tool: rolling 24-hour limit and per-merchant limits of a policy (docs/16 §2).
// Stand-in for the Policy Details page until the wallet UI covers it.
//
// Run inside WSL with the policy OWNER key (amounts are base units of the policy mint):
//   node scripts/policy-limits.mjs show            --policy <address> [--merchant <wallet>]
//   node scripts/policy-limits.mjs set-rolling     --policy <address> --limit <base units>
//   node scripts/policy-limits.mjs close-rolling   --policy <address>
//   node scripts/policy-limits.mjs set-merchant    --policy <address> --merchant <wallet> --max-per-tx <n> --daily <n>
//   node scripts/policy-limits.mjs close-merchant  --policy <address> --merchant <wallet>
//   common options: [--keypair ~/.config/solana/id.json] [--rpc <url>]
//
// The program enforces owner-only access (UnauthorizedOwner otherwise). The rule accounts are
// optional: they exist ⇒ enforced by execute_payment; closing them refunds rent to the owner.

import { devnetConnection, loadKeypair, log, parseArgs, require } from "./lib/common.mjs";

const { PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } = require("@solana/web3.js");
const { AnchorProvider, BN, Program } = require("@anchor-lang/core");
const idl = require("./src/lib/anchor/idl/agent_payment_firewall.json");

const ACTIONS = ["show", "set-rolling", "close-rolling", "set-merchant", "close-merchant"];
const action = process.argv[2];
if (!ACTIONS.includes(action)) {
  console.error(`usage: node scripts/policy-limits.mjs ${ACTIONS.join("|")} --policy <address> [...]`);
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
const seed = (name) => Uint8Array.from(JSON.parse(idl.constants.find((c) => c.name === name).value));
const rulesPda = PublicKey.findProgramAddressSync([seed("SEED_RULES"), policy.toBytes()], program.programId)[0];
const merchant = args.merchant ? new PublicKey(args.merchant) : null;
const merchantLimitPda = (m) =>
  PublicKey.findProgramAddressSync([seed("SEED_MERCHANT_LIMIT"), policy.toBytes(), m.toBytes()], program.programId)[0];
const merchantAllowlistPda = (m) =>
  PublicKey.findProgramAddressSync([seed("SEED_MERCHANT"), policy.toBytes(), m.toBytes()], program.programId)[0];
const needMerchant = () => {
  if (!merchant) throw new Error("--merchant is required");
  return merchant;
};
const amount = (name) => {
  const v = args[name];
  if (!v || !/^\d+$/.test(v)) throw new Error(`--${name} must be an integer amount in base units`);
  return new BN(v);
};

async function show() {
  const rules = await program.account.spendingRules.fetchNullable(rulesPda);
  if (rules) {
    const slot = await connection.getSlot("confirmed");
    const now = (await connection.getBlockTime(slot)) ?? Math.floor(Date.now() / 1000);
    const hour = Math.floor(now / 3600);
    const current = Number(rules.currentHour);
    // Same lazy rotation as the program: bucket i holds the hour h ≤ current_hour with
    // h ≡ i (mod 24); it counts while now's hour − h < 24.
    const inWindow = rules.buckets.reduce((sum, b, i) => {
      const bucketHour = current - ((((current - i) % 24) + 24) % 24);
      return hour - bucketHour < 24 ? sum + BigInt(b.toString()) : sum;
    }, 0n);
    log("rolling limit", `${rules.rollingLimit.toString()} (spent in window ≈ ${inWindow})`);
  } else {
    log("rolling limit", "none");
  }
  if (merchant) {
    const m = await program.account.merchantLimit.fetchNullable(merchantLimitPda(merchant));
    log(
      "merchant limit",
      m
        ? `max/tx ${m.maxPerTx.toString()}, daily ${m.dailyLimit.toString()}, spent ${m.spentToday.toString()} (day ${m.dayIndex.toString()})`
        : "none",
    );
  }
}

if (action === "show") {
  await show();
  process.exit(0);
}

const p = await program.account.agentPolicy.fetch(policy);
if (!p.owner.equals(owner.publicKey)) {
  throw new Error(`this keypair (${owner.publicKey.toBase58()}) is not the policy owner (${p.owner.toBase58()})`);
}
let ix;
if (action === "set-rolling") {
  ix = await program.methods
    .setSpendingRules(amount("limit"))
    .accountsStrict({ owner: owner.publicKey, policy, spendingRules: rulesPda, systemProgram: SystemProgram.programId })
    .instruction();
} else if (action === "close-rolling") {
  ix = await program.methods
    .closeSpendingRules()
    .accountsStrict({ owner: owner.publicKey, policy, spendingRules: rulesPda })
    .instruction();
} else if (action === "set-merchant") {
  const m = needMerchant();
  ix = await program.methods
    .setMerchantLimit(amount("max-per-tx"), amount("daily"))
    .accountsStrict({
      owner: owner.publicKey,
      policy,
      merchant: m,
      merchantAllowlist: merchantAllowlistPda(m),
      merchantLimit: merchantLimitPda(m),
      systemProgram: SystemProgram.programId,
    })
    .instruction();
} else {
  const m = needMerchant();
  ix = await program.methods
    .closeMerchantLimit()
    .accountsStrict({ owner: owner.publicKey, policy, merchant: m, merchantLimit: merchantLimitPda(m) })
    .instruction();
}
const signature = await sendAndConfirmTransaction(connection, new Transaction().add(ix), [owner], {
  commitment: "confirmed",
});
log(action, signature);
log("explorer", `https://explorer.solana.com/tx/${signature}?cluster=devnet`);
await show();
process.exit(0);
