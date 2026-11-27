#!/usr/bin/env node
// Sync the Anchor-generated IDL + TS types into the Next.js app (docs/02 §4, T-M4-02).
//
// Run INSIDE WSL after `anchor build` (anchor/target is a symlink into the WSL ext4
// filesystem that Windows Node cannot follow):
//
//   node scripts/sync-idl.mjs                    # validate + copy
//   node scripts/sync-idl.mjs --check            # validate + fail if committed copies are stale (no writes)
//   node scripts/sync-idl.mjs --compare FILE     # additionally require byte-equality with FILE
//                                                # (e.g. `anchor idl fetch <id> -o FILE` from devnet)
//   node scripts/sync-idl.mjs --source DIR       # Anchor target dir (default: anchor/target)
//
// Files are copied byte-for-byte (no headers added) so the committed IDL can be compared
// with the on-chain IDL. Exit code 1 on any validation failure.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROGRAM = "agent_payment_firewall";
const DEST = join(ROOT, "app", "src", "lib", "anchor", "idl");
const LIB_RS = join(ROOT, "anchor", "programs", PROGRAM, "src", "lib.rs");
const EXPECTED_INSTRUCTIONS = [
  "add_merchant",
  "execute_payment",
  "initialize_policy",
  "pause_policy",
  "remove_merchant",
  "resume_policy",
  "update_policy",
  "withdraw",
];
const EXPECTED_ACCOUNTS = ["AgentPolicy", "MerchantAllowlist", "PaymentReceipt"];

// ---------- args ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const CHECK_ONLY = flag("--check");
const COMPARE = option("--compare");
const SOURCE = resolve(ROOT, option("--source") ?? join("anchor", "target"));

const FILES = [
  { from: join(SOURCE, "idl", `${PROGRAM}.json`), to: join(DEST, `${PROGRAM}.json`) },
  { from: join(SOURCE, "types", `${PROGRAM}.ts`), to: join(DEST, `${PROGRAM}.ts`) },
  { from: join(SOURCE, "types", `${PROGRAM}_errors.ts`), to: join(DEST, `${PROGRAM}_errors.ts`) },
];

// ---------- helpers ----------
const errors = [];
const fail = (msg) => errors.push(msg);
const rel = (p) => relative(ROOT, p).replaceAll("\\", "/");
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s) {
  let n = 0n;
  for (const c of s) {
    const v = B58.indexOf(c);
    if (v < 0) throw new Error(`invalid base58 character '${c}'`);
    n = n * 58n + BigInt(v);
  }
  const bytes = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of s) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

/** Minimal KEY=VALUE reader for .env files (no interpolation). */
function readEnvValue(file, key) {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

function expectedProgramId() {
  const candidates = [
    ["process.env", process.env.NEXT_PUBLIC_PROGRAM_ID],
    ["app/.env.local", readEnvValue(join(ROOT, "app", ".env.local"), "NEXT_PUBLIC_PROGRAM_ID")],
    [".env.example", readEnvValue(join(ROOT, ".env.example"), "NEXT_PUBLIC_PROGRAM_ID")],
  ];
  for (const [source, value] of candidates) {
    if (value && !value.startsWith("<")) return { source, value };
  }
  return undefined;
}

// ---------- read source ----------
for (const f of FILES) {
  if (!existsSync(f.from)) {
    fail(
      `missing ${rel(f.from)} — run \`anchor build\` first (in WSL; anchor/target is a WSL symlink).`,
    );
  }
}
if (errors.length) finish();

const idlBuf = readFileSync(FILES[0].from);
let idl;
try {
  idl = JSON.parse(idlBuf.toString("utf8"));
} catch (e) {
  fail(`IDL is not valid JSON: ${e.message}`);
  finish();
}

// ---------- validate IDL ----------
const address = idl.address;
try {
  if (base58Decode(address ?? "").length !== 32) fail(`IDL address is not a 32-byte key: ${address}`);
} catch (e) {
  fail(`IDL address is not base58: ${e.message}`);
}
if (idl.metadata?.name !== PROGRAM) fail(`IDL metadata.name is '${idl.metadata?.name}', expected '${PROGRAM}'`);

const ixNames = (idl.instructions ?? []).map((i) => i.name).sort();
const missingIx = EXPECTED_INSTRUCTIONS.filter((n) => !ixNames.includes(n));
if (missingIx.length) fail(`IDL is missing instructions: ${missingIx.join(", ")}`);
const accNames = (idl.accounts ?? []).map((a) => a.name);
const missingAcc = EXPECTED_ACCOUNTS.filter((n) => !accNames.includes(n));
if (missingAcc.length) fail(`IDL is missing accounts: ${missingAcc.join(", ")}`);
const codes = (idl.errors ?? []).map((e) => e.code);
if (!codes.length || codes.some((c, i) => c !== 6000 + i)) {
  fail(`IDL error codes are not contiguous from 6000: ${codes.join(",")}`);
}

// IDL address == declare_id! in the program source.
const declared = readFileSync(LIB_RS, "utf8").match(/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\)/)?.[1];
if (!declared) fail(`could not find declare_id! in ${rel(LIB_RS)}`);
else if (declared !== address) fail(`IDL address ${address} != declare_id! ${declared}`);

// IDL address == NEXT_PUBLIC_PROGRAM_ID (acceptance criterion of T-M4-02).
const expected = expectedProgramId();
if (!expected) {
  fail("NEXT_PUBLIC_PROGRAM_ID is not set (process.env, app/.env.local or .env.example).");
} else if (expected.value !== address) {
  fail(`IDL address ${address} != NEXT_PUBLIC_PROGRAM_ID ${expected.value} (from ${expected.source})`);
}

// Optional: byte-equality with an IDL fetched from the cluster.
if (COMPARE) {
  if (!existsSync(COMPARE)) fail(`--compare file not found: ${COMPARE}`);
  else if (sha256(readFileSync(COMPARE)) !== sha256(idlBuf)) {
    fail(`local IDL differs from ${COMPARE} (redeploy, or fetch the IDL again)`);
  }
}

if (errors.length) finish();

// ---------- copy or check ----------
for (const f of FILES) {
  const src = readFileSync(f.from);
  const current = existsSync(f.to) ? readFileSync(f.to) : undefined;
  const upToDate = current !== undefined && sha256(current) === sha256(src);
  if (CHECK_ONLY) {
    if (!upToDate) {
      fail(`${rel(f.to)} is ${current ? "stale" : "missing"} — run node scripts/sync-idl.mjs`);
    }
  } else if (!upToDate) {
    mkdirSync(DEST, { recursive: true });
    writeFileSync(f.to, src);
  }
  console.log(
    `${CHECK_ONLY ? "checked" : upToDate ? "unchanged" : "copied "}  ${rel(f.to)}  sha256=${sha256(src).slice(0, 16)}…`,
  );
}

console.log(`program id ${address} (matches declare_id! and NEXT_PUBLIC_PROGRAM_ID from ${expected.source})`);
if (COMPARE) console.log(`IDL is byte-identical to ${COMPARE}`);
finish();

function finish() {
  if (errors.length) {
    for (const e of errors) console.error(`ERROR: ${e}`);
    process.exit(1);
  }
  console.log(CHECK_ONLY ? "IDL check passed." : "IDL sync complete.");
  process.exit(0);
}
