#!/usr/bin/env node
// Verifies a deployed AgentPay Guard app (T-M4-13). Read-only: no transactions, no LLM calls.
//
//   node scripts/verify-deployment.mjs https://<deployment>.vercel.app [--expect-demo off|on]
//        [--expect-x402 off|on] [--policy <policy address for a read check>]
//        [--program-so <path to the local agent_payment_firewall.so>]
//
// Checks: /health (devnet, program id, agent key, SOL, fee payer SOL, config flags, demo flag),
// demo and x402 gating, that the DEPLOYED program binary equals the local build (when the .so is
// readable — run from WSL, the default path is anchor/target/deploy/…), read routes, pages, and
// that NO secret (names or local values) appears in client JS.
// Local secrets are read from app/.env.local only to search for them; they are never printed.

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(ROOT, "app", "package.json"));

const args = process.argv.slice(2);
const base = args.find((a) => !a.startsWith("--"))?.replace(/\/+$/, "");
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
if (!base || !/^https?:\/\//.test(base)) {
  console.error(
    "usage: node scripts/verify-deployment.mjs https://<deployment> [--expect-demo off|on] [--expect-x402 off|on] [--policy <addr>] [--program-so <path>]",
  );
  process.exit(2);
}
const expectDemo = (opt("--expect-demo") ?? "off") === "on";
const expectX402 = (opt("--expect-x402") ?? "off") === "on";
const policy = opt("--policy");
const programSo = opt("--program-so") ?? join(ROOT, "anchor", "target", "deploy", "agent_payment_firewall.so");

let failures = 0;
const check = (ok, label, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};
const get = (path, init) => fetch(`${base}${path}`, { redirect: "manual", ...init });

// ---------- local reference values ----------
const idl = JSON.parse(readFileSync(join(ROOT, "app/src/lib/anchor/idl/agent_payment_firewall.json"), "utf8"));
const envFile = join(ROOT, "app", ".env.local");
const localEnv = {};
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) localEnv[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
let expectedAgent;
if (localEnv.AGENT_SECRET_KEY?.startsWith("[")) {
  const { Keypair } = require("@solana/web3.js");
  expectedAgent = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(localEnv.AGENT_SECRET_KEY))).publicKey.toBase58();
}

// ---------- /health ----------
const healthRes = await get("/api/v1/health");
const health = (await healthRes.json().catch(() => ({}))).data ?? {};
check(healthRes.status === 200, "GET /api/v1/health → 200", `HTTP ${healthRes.status}`);
check(health.cluster === "devnet", "cluster is devnet", String(health.cluster));
check(health.programId === idl.address, "program id matches the committed IDL", String(health.programId));
check(health.programIdConfigOk === true, "NEXT_PUBLIC_PROGRAM_ID matches the IDL");
check(Boolean(health.agentPubkey), "agent key configured", String(health.agentPubkey));
if (expectedAgent) check(health.agentPubkey === expectedAgent, "agent key matches local AGENT_SECRET_KEY");
const sol = Number(health.agentSolBalanceLamports ?? 0) / 1e9;
check(sol >= 0.05, "agent has SOL for fees + receipt rent", `${sol} SOL`);
check(health.rpcError === null && Number.isInteger(health.rpcSlot), "server RPC reachable", `slot ${health.rpcSlot}`);
check(health.allowedOwnersConfigured === true, "ALLOWED_POLICY_OWNERS configured");
check(health.llmConfigured === true, "ANTHROPIC_API_KEY configured");
check(health.firecrawlConfigured === true, "FIRECRAWL_API_KEY configured");
if (health.feePayerPubkey) {
  const feeSol = Number(health.feePayerSolBalanceLamports ?? 0) / 1e9;
  check(feeSol >= 0.01, "separate fee payer has SOL", `${feeSol} SOL`);
}
check(Boolean(health.demo?.enabled) === expectDemo, `DEMO_MODE is ${expectDemo ? "on" : "off"}`, String(health.demo?.enabled));

// ---------- demo gating ----------
const demoApi = await get("/api/v1/demo/prompt-injection", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ policy: idl.address, agentMode: "SCRIPTED", submitOnChain: false }),
});
if (expectDemo) check(demoApi.status !== 404, "demo route enabled", `HTTP ${demoApi.status}`);
else check(demoApi.status === 404, "demo route disabled (404)", `HTTP ${demoApi.status}`);
const page = await get("/demo/malicious-merchant");
check(expectDemo ? page.status === 200 : page.status === 404, `malicious demo page ${expectDemo ? "served" : "hidden (404)"}`, `HTTP ${page.status}`);

// ---------- x402 gating (F-01) ----------
// Invalid body: when disabled the route answers 403 X402_DISABLED before parsing; when enabled it
// answers 400 VALIDATION_ERROR. Nothing is fetched, signed or sent either way.
const x402 = await get("/api/v1/agent/x402/pay", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
});
const x402Body = await x402.json().catch(() => ({}));
const x402Disabled = x402.status === 403 && x402Body.error?.code === "X402_DISABLED";
check(x402Disabled === !expectX402, `x402 is ${expectX402 ? "enabled" : "disabled (X402_ALLOWED_HOSTS empty)"}`, `HTTP ${x402.status}`);

// ---------- deployed program == local build ----------
// Upgradeable loader: program account = [u32 tag][programdata address]; programdata account =
// 45-byte header + ELF (padded with zeros to the allocated length).
let localSo = null;
try {
  localSo = readFileSync(programSo);
} catch {
  console.log(`SKIP  deployed program vs local build — ${programSo} not readable (run from WSL or pass --program-so)`);
}
if (localSo) {
  const { Connection, PublicKey } = require("@solana/web3.js");
  const conn = new Connection(localEnv.SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
  const programInfo = await conn.getAccountInfo(new PublicKey(idl.address));
  const dataInfo = programInfo && (await conn.getAccountInfo(new PublicKey(programInfo.data.subarray(4, 36))));
  const elf = dataInfo ? dataInfo.data.subarray(45) : Buffer.alloc(0);
  const same =
    elf.length >= localSo.length &&
    Buffer.compare(elf.subarray(0, localSo.length), localSo) === 0 &&
    elf.subarray(localSo.length).every((b) => b === 0);
  check(same, "deployed program bytes equal the local build", `on-chain ${elf.length} B, local ${localSo.length} B`);
}

// ---------- routes & pages ----------
const bad = await get("/api/v1/policies/not-a-key");
check(bad.status === 400, "invalid policy address → 400", `HTTP ${bad.status}`);
if (policy) {
  const p = await get(`/api/v1/policies/${policy}`);
  const body = await p.json().catch(() => ({}));
  check(p.status === 200 && body.data?.address === policy, "policy read returns on-chain data", `HTTP ${p.status}`);
}
for (const path of ["/", "/security", "/agent", "/dashboard", "/policies"]) {
  const r = await get(path);
  check(r.status === 200, `page ${path} → 200`, `HTTP ${r.status}`);
}

// ---------- secrets must not be in client JavaScript ----------
const chunks = new Set();
for (const path of ["/", "/security", "/agent", "/dashboard", "/policies"]) {
  const html = await (await get(path)).text();
  for (const m of html.matchAll(/["'](\/_next\/static\/[^"'?]+\.js)/g)) chunks.add(m[1]);
}
const SECRET_KEYS = ["AGENT_SECRET_KEY", "FEE_PAYER_SECRET_KEY", "ANTHROPIC_API_KEY", "FIRECRAWL_API_KEY", "SESSION_SECRET", "AWS_KMS_KEY_ID"];
const needles = Object.fromEntries(SECRET_KEYS.map((k) => [`name ${k}`, k]));
for (const key of SECRET_KEYS) {
  const v = localEnv[key];
  if (v && v.length > 20 && !v.startsWith("<")) needles[`value of ${key} (slice)`] = v.startsWith("[") ? v.slice(1, 40) : v.slice(6, 30);
}
const hits = Object.fromEntries(Object.keys(needles).map((k) => [k, 0]));
for (const c of chunks) {
  const js = await (await get(c)).text();
  for (const [label, needle] of Object.entries(needles)) if (js.includes(needle)) hits[label]++;
}
check(chunks.size > 0, "client JS chunks found to scan", `${chunks.size} files`);
for (const [label, n] of Object.entries(hits)) check(n === 0, `client JS free of ${label}`, `${n} file(s)`);

console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
