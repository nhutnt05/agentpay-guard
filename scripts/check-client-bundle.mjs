#!/usr/bin/env node
// T-21 / docs/09 §6: after `next build`, prove the browser bundle contains no server secret.
// Scans app/.next/static (everything shipped to the browser) for
//   1. the NAMES of server-only env vars (a reference means server code leaked client-side), and
//   2. the VALUES of those vars from the environment and app/.env.local (if set).
// Prints only variable names and file paths, never secret values. Exit 1 on any hit.
//
// Usage: (cd app && pnpm build) && node scripts/check-client-bundle.mjs

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const staticDir = join(root, "app", ".next", "static");

const SECRET_VARS = [
  "AGENT_SECRET_KEY",
  "FEE_PAYER_SECRET_KEY",
  "SESSION_SECRET",
  "ANTHROPIC_API_KEY",
  "FIRECRAWL_API_KEY",
  "AWS_KMS_KEY_ID",
];

function readEnvFile(path) {
  const out = {};
  if (!existsSync(path)) return out;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

if (!existsSync(staticDir)) {
  console.error(`No build output at ${relative(root, staticDir)} — run \`pnpm build\` in app/ first.`);
  process.exit(2);
}

const fileEnv = readEnvFile(join(root, "app", ".env.local"));
const needles = [];
for (const name of SECRET_VARS) {
  needles.push({ label: `name ${name}`, text: name });
  const value = process.env[name] || fileEnv[name];
  // Very short values would match by accident; real secrets are long.
  if (value && value.length >= 16) needles.push({ label: `value of ${name}`, text: value });
}

let files = 0;
const hits = [];
for (const file of walk(staticDir)) {
  files += 1;
  const content = readFileSync(file, "utf8");
  for (const n of needles) {
    if (content.includes(n.text)) hits.push(`${n.label} in ${relative(root, file)}`);
  }
}

const withValues = needles.filter((n) => n.label.startsWith("value")).length;
console.log(`Scanned ${files} client files for ${SECRET_VARS.length} secret names and ${withValues} secret values.`);
if (hits.length) {
  console.error("FAIL — secrets reachable from the browser bundle:");
  for (const h of hits) console.error(`  - ${h}`);
  process.exit(1);
}
console.log("PASS — no server secret name or value in app/.next/static.");
