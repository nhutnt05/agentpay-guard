#!/usr/bin/env node
// Creates the demo test token "tUSDC" (classic SPL Token, 6 decimals) on DEVNET and mints
// test tokens to the policy owners, so they can fund a vault from their wallet (T-M4-09).
//
// Run inside WSL (the payer keypair lives there):
//   node scripts/create-test-mint.mjs [--keypair ~/.config/solana/id.json]
//        [--to <pubkey,pubkey>] [--amount 1000] [--rpc <url>] [--write-env]
//
//  --to         recipients (default: ALLOWED_POLICY_OWNERS from app/.env.local)
//  --amount     whole tUSDC per recipient (default 1000)
//  --write-env  set NEXT_PUBLIC_DEMO_MINT in app/.env.local (only that key is touched)
//
// The payer is the mint authority. Prints public keys and signatures only.

import {
  devnetConnection,
  loadKeypair,
  log,
  parseArgs,
  readEnvValue,
  require,
  updateEnvFile,
} from "./lib/common.mjs";

const { PublicKey } = require("@solana/web3.js");
const spl = require("@solana/spl-token");

const DECIMALS = 6;
const args = parseArgs();
const payer = loadKeypair(args.keypair ?? "~/.config/solana/id.json");
const amountWhole = BigInt(args.amount ?? "1000");
if (amountWhole <= 0n) throw new Error("--amount must be positive");

const recipientsRaw = args.to ?? readEnvValue("ALLOWED_POLICY_OWNERS");
if (!recipientsRaw) throw new Error("no recipients: pass --to or set ALLOWED_POLICY_OWNERS in app/.env.local");
const recipients = recipientsRaw
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => new PublicKey(s));

const connection = await devnetConnection(args.rpc);
log("cluster", "devnet (genesis hash verified)");
log("payer / mint authority", payer.publicKey.toBase58());

const mint = await spl.createMint(
  connection,
  payer,
  payer.publicKey, // mint authority
  null, // no freeze authority
  DECIMALS,
  undefined,
  { commitment: "confirmed" },
  spl.TOKEN_PROGRAM_ID, // classic SPL Token only (ADR-009)
);
log("mint (tUSDC, 6 decimals)", mint.toBase58());

const units = amountWhole * 10n ** BigInt(DECIMALS);
for (const owner of recipients) {
  // allowOwnerOffCurve=false: recipients are wallets.
  const ata = await spl.getOrCreateAssociatedTokenAccount(connection, payer, mint, owner, false, "confirmed");
  const sig = await spl.mintTo(connection, payer, mint, ata.address, payer, units, [], { commitment: "confirmed" });
  const balance = (await connection.getTokenAccountBalance(ata.address, "confirmed")).value.uiAmountString;
  log(`minted to ${owner.toBase58().slice(0, 8)}…`, `${balance} tUSDC (ATA ${ata.address.toBase58()}, tx ${sig})`);
}

console.log(`\nNEXT_PUBLIC_DEMO_MINT=${mint.toBase58()}`);
if (args._flags.has("write-env")) {
  updateEnvFile({ NEXT_PUBLIC_DEMO_MINT: mint.toBase58() });
  console.log("app/.env.local: NEXT_PUBLIC_DEMO_MINT updated (no other key touched)");
}

// web3.js keeps a websocket open after confirmations; exit explicitly once done.
process.exit(0);
