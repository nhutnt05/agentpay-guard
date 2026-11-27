// Shared helpers for devnet setup scripts (run inside WSL, where the CLI keypairs live).
// Uses the app's installed packages so there is a single dependency set.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const APP_ENV_FILE = join(ROOT, "app", ".env.local");
export const require = createRequire(join(ROOT, "app", "package.json"));

/** Devnet genesis hash — the scripts refuse to run anywhere else (NFR-5). */
export const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

// ---------- args ----------
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument '${a}'`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out._flags.add(key);
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export const expandHome = (p) => (p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

// ---------- .env.local ----------
/** Reads one KEY from app/.env.local (undefined if missing or a <placeholder>). */
export function readEnvValue(key, file = APP_ENV_FILE) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) {
      const v = m[2].replace(/^["']|["']$/g, "");
      return v && !v.startsWith("<") ? v : undefined;
    }
  }
  return undefined;
}

/**
 * Sets ONLY the given keys in app/.env.local, keeping every other line (including secrets)
 * byte-for-byte. Existing keys are replaced in place; missing keys are appended.
 */
export function updateEnvFile(updates, file = APP_ENV_FILE) {
  if (!existsSync(file)) throw new Error(`${file} does not exist — copy .env.example first`);
  const original = readFileSync(file, "utf8");
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);
  const pending = new Map(Object.entries(updates));
  const next = lines.map((line) => {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && pending.has(m[1])) {
      const value = pending.get(m[1]);
      pending.delete(m[1]);
      return `${m[1]}=${value}`;
    }
    return line;
  });
  if (pending.size) {
    // Drop the empty element produced by a trailing newline, append, then restore it.
    if (next.length && next[next.length - 1] === "") next.pop();
    for (const [k, v] of pending) next.push(`${k}=${v}`);
    next.push("");
  }
  writeFileSync(file, next.join(eol));
}

// ---------- solana ----------
export function loadKeypair(path) {
  const { Keypair } = require("@solana/web3.js");
  const file = expandHome(path);
  if (!existsSync(file)) throw new Error(`keypair file not found: ${file}`);
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
}

/** Connection to devnet; throws if the RPC is not devnet (checked by genesis hash). */
export async function devnetConnection(rpcUrl) {
  const { Connection, clusterApiUrl } = require("@solana/web3.js");
  const url = rpcUrl ?? readEnvValue("SOLANA_RPC_URL") ?? clusterApiUrl("devnet");
  const connection = new Connection(url, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS_HASH) {
    throw new Error(`refusing to run: RPC is not devnet (genesis ${genesis})`);
  }
  return connection;
}

export const log = (label, value) => console.log(`${label.padEnd(26)} ${value}`);
