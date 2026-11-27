#!/usr/bin/env node
// Prepares the DEVNET demo wallets for the security demo (T-M4-09, docs/13 §0):
//  - demo merchant  "Acme Data API": the owner allowlists it in the UI; receives payments
//  - demo attacker: NEVER allowlisted. Its token account is created so that, in the
//    prompt-injection demo, the allowlist is the ONLY failing rule (EP-03).
// Neither wallet ever signs, so only public keys are generated — no secret keys are saved.
// Also checks that the server agent has SOL for fees + receipt rent.
//
// Run inside WSL:
//   node scripts/setup-demo.mjs [--mint <pubkey>] [--keypair ~/.config/solana/id.json]
//        [--agent-keypair ~/.config/agentpay/agent.json] [--rpc <url>] [--write-env]
//
//  --mint       default: NEXT_PUBLIC_DEMO_MINT from app/.env.local
//  --write-env  set DEMO_MERCHANT_WALLET and DEMO_ATTACKER_WALLET in app/.env.local only

import {
  devnetConnection,
  loadKeypair,
  log,
  parseArgs,
  readEnvValue,
  require,
  updateEnvFile,
} from "./lib/common.mjs";

const { Keypair, LAMPORTS_PER_SOL, PublicKey } = require("@solana/web3.js");
const spl = require("@solana/spl-token");

const MIN_AGENT_SOL = 0.1;
const args = parseArgs();
const payer = loadKeypair(args.keypair ?? "~/.config/solana/id.json");
const mintRaw = args.mint ?? readEnvValue("NEXT_PUBLIC_DEMO_MINT");
if (!mintRaw) throw new Error("no mint: pass --mint or run create-test-mint.mjs --write-env first");
const mint = new PublicKey(mintRaw);

const connection = await devnetConnection(args.rpc);
log("cluster", "devnet (genesis hash verified)");

const mintInfo = await spl.getMint(connection, mint, "confirmed", spl.TOKEN_PROGRAM_ID);
if (mintInfo.decimals !== 6) throw new Error(`mint has ${mintInfo.decimals} decimals, expected 6`);
log("mint", `${mint.toBase58()} (classic SPL, 6 decimals)`);

// Public keys only: these wallets receive tokens but never sign.
const merchant = Keypair.generate().publicKey;
const attacker = Keypair.generate().publicKey;

for (const [label, wallet] of [
  ["demo merchant (Acme)", merchant],
  ["demo attacker", attacker],
]) {
  const ata = await spl.getOrCreateAssociatedTokenAccount(connection, payer, mint, wallet, false, "confirmed");
  log(label, `${wallet.toBase58()} (ATA ${ata.address.toBase58()})`);
}

// Agent SOL check (public key derived locally; the secret is never printed).
const agentPath = args["agent-keypair"] ?? "~/.config/agentpay/agent.json";
const agent = loadKeypair(agentPath).publicKey;
const agentSol = (await connection.getBalance(agent, "confirmed")) / LAMPORTS_PER_SOL;
log("server agent", `${agent.toBase58()} — ${agentSol} SOL`);
if (agentSol < MIN_AGENT_SOL) {
  console.warn(`WARNING: agent has < ${MIN_AGENT_SOL} SOL; fund it: solana airdrop 1 ${agent.toBase58()} --url devnet`);
}

console.log(`\nDEMO_MERCHANT_WALLET=${merchant.toBase58()}`);
console.log(`DEMO_ATTACKER_WALLET=${attacker.toBase58()}`);
console.log("\nNext: in the UI, create a policy with agent", agent.toBase58(), "and allowlist ONLY the demo merchant.");
if (args._flags.has("write-env")) {
  updateEnvFile({ DEMO_MERCHANT_WALLET: merchant.toBase58(), DEMO_ATTACKER_WALLET: attacker.toBase58() });
  console.log("app/.env.local: DEMO_MERCHANT_WALLET, DEMO_ATTACKER_WALLET updated (no other key touched)");
}

// web3.js keeps a websocket open after confirmations; exit explicitly once done.
process.exit(0);
