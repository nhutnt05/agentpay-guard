#!/usr/bin/env node
// Verifies a deployed AgentPay Guard app (T-M4-13). Read-only: no transactions, no LLM calls.
//
//   node scripts/verify-deployment.mjs https://<deployment>.vercel.app [--expect-demo off|on]
//        [--policy <policy address for a read check>]
//
// Checks: /health (devnet, program id, agent key, SOL, config flags, demo flag), demo gating,
// read routes, pages, and that NO secret (names or local values) appears in client JS.
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
  console.error("usage: node scripts/verify-deployment.mjs https://<deployment> [--expect-demo off|on] [--policy <addr>]");
  process.exit(2);
}
const expectDemo = (opt("--expect-demo") ?? "off") === "on";
const policy = opt("--policy");

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

// ---------- routes & pages ----------
const bad = await get("/api/v1/policies/not-a-key");
check(bad.status === 400, "invalid policy address → 400", `HTTP ${bad.status}`);
if (policy) {
  const p = await get(`/api/v1/policies/${policy}`);
  const body = await p.json().catch(() => ({}));
  check(p.status === 200 && body.data?.address === policy, "policy read returns on-chain data", `HTTP ${p.status}`);
}
for (const path of ["/", "/security", "/agent"]) {
  const r = await get(path);
  check(r.status === 200, `page ${path} → 200`, `HTTP ${r.status}`);
}

// ---------- secrets must not be in client JavaScript ----------
const chunks = new Set();
for (const path of ["/", "/security", "/agent"]) {
  const html = await (await get(path)).text();
  for (const m of html.matchAll(/["'](\/_next\/static\/[^"'?]+\.js)/g)) chunks.add(m[1]);
}
const needles = { "name AGENT_SECRET_KEY": "AGENT_SECRET_KEY", "name ANTHROPIC_API_KEY": "ANTHROPIC_API_KEY", "name FIRECRAWL_API_KEY": "FIRECRAWL_API_KEY", "name SESSION_SECRET": "SESSION_SECRET" };
for (const key of ["AGENT_SECRET_KEY", "ANTHROPIC_API_KEY", "FIRECRAWL_API_KEY", "SESSION_SECRET"]) {
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
