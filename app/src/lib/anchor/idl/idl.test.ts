import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import idl from "./agent_payment_firewall.json";
import { AgentPaymentFirewallErrorCode } from "./agent_payment_firewall_errors";

// Guards the committed IDL copies (T-M4-02). Regenerate with `node scripts/sync-idl.mjs`
// inside WSL after `anchor build`; `--check` verifies freshness against anchor/target.

/** Reads one KEY from a .env-style file without loading anything else (no secrets). */
function readEnvValue(file: string, key: string): string | undefined {
  if (!existsSync(file)) return undefined;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
  }
  return undefined;
}

/** Same precedence as scripts/sync-idl.mjs: process.env → app/.env.local → .env.example. */
function expectedProgramId(): string | undefined {
  const appDir = process.cwd();
  return [
    process.env.NEXT_PUBLIC_PROGRAM_ID,
    readEnvValue(resolve(appDir, ".env.local"), "NEXT_PUBLIC_PROGRAM_ID"),
    readEnvValue(resolve(appDir, "..", ".env.example"), "NEXT_PUBLIC_PROGRAM_ID"),
  ].find((v) => v && !v.startsWith("<"));
}

describe("synced Anchor IDL", () => {
  it("address equals NEXT_PUBLIC_PROGRAM_ID (T-M4-02 acceptance)", () => {
    const expected = expectedProgramId();
    expect(expected, "NEXT_PUBLIC_PROGRAM_ID must be configured").toBeDefined();
    expect(idl.address).toBe(expected);
  });

  it("describes the agent_payment_firewall program", () => {
    expect(idl.metadata.name).toBe("agent_payment_firewall");
    expect(idl.instructions.map((i) => i.name).sort()).toEqual([
      "add_merchant",
      "execute_payment",
      "initialize_policy",
      "pause_policy",
      "remove_merchant",
      "resume_policy",
      "update_policy",
      "withdraw",
    ]);
    expect(idl.accounts.map((a) => a.name).sort()).toEqual([
      "AgentPolicy",
      "MerchantAllowlist",
      "PaymentReceipt",
    ]);
  });

  it("error codes are contiguous from 6000 and match the generated error map", () => {
    const codes = idl.errors.map((e) => e.code);
    expect(codes).toEqual(codes.map((_, i) => 6000 + i));
    const fromIdl = Object.fromEntries(idl.errors.map((e) => [e.name, e.code]));
    expect(fromIdl).toEqual(AgentPaymentFirewallErrorCode);
    // Codes the backend maps explicitly (docs/11 §7).
    expect(AgentPaymentFirewallErrorCode.MerchantNotAllowed).toBe(6003);
    expect(AgentPaymentFirewallErrorCode.InvalidRequestHash).toBe(6011);
  });

  it("execute_payment arguments keep the documented order", () => {
    const ix = idl.instructions.find((i) => i.name === "execute_payment");
    expect(ix?.args.map((a) => a.name)).toEqual([
      "request_hash",
      "request_id",
      "amount",
      "expires_at",
    ]);
  });
});
