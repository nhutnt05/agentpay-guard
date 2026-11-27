import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { AccessConfigError, checkPolicyServed, parseAllowedOwners } from "./access";

// API-07 (logic): the server agent acts only for policies whose ON-CHAIN agent is this
// server's agent and whose ON-CHAIN owner is allowlisted; everything else is denied (403).
const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));
const OWNER = key(1);
const OTHER_OWNER = key(2);
const AGENT = key(3);

describe("policy access (API-07)", () => {
  const allowed = parseAllowedOwners(`${OWNER.toBase58()}`);

  it("allows a policy of an allowlisted owner that uses the server agent", () => {
    expect(checkPolicyServed({ owner: OWNER, agent: AGENT }, AGENT, allowed)).toEqual({ allowed: true });
  });

  it("denies an owner that is not in ALLOWED_POLICY_OWNERS", () => {
    expect(checkPolicyServed({ owner: OTHER_OWNER, agent: AGENT }, AGENT, allowed)).toEqual({
      allowed: false,
      reason: "OWNER_NOT_ALLOWED",
    });
  });

  it("denies a policy whose agent is a different key (cannot sign for it anyway)", () => {
    expect(checkPolicyServed({ owner: OWNER, agent: key(9) }, AGENT, allowed)).toEqual({
      allowed: false,
      reason: "AGENT_MISMATCH",
    });
  });

  it("denies everything when the allowlist is empty (safe default)", () => {
    expect(checkPolicyServed({ owner: OWNER, agent: AGENT }, AGENT, parseAllowedOwners(""))).toEqual({
      allowed: false,
      reason: "ALLOWLIST_NOT_CONFIGURED",
    });
  });

  it("denies everything when the server agent key is not configured", () => {
    expect(checkPolicyServed({ owner: OWNER, agent: AGENT }, null, allowed)).toEqual({
      allowed: false,
      reason: "AGENT_NOT_CONFIGURED",
    });
  });

  it("parses comma-separated owners, ignoring blanks, and rejects invalid keys", () => {
    const set = parseAllowedOwners(` ${OWNER.toBase58()} , , ${OTHER_OWNER.toBase58()},`);
    expect([...set].sort()).toEqual([OWNER.toBase58(), OTHER_OWNER.toBase58()].sort());
    expect(() => parseAllowedOwners(`${OWNER.toBase58()},nope`)).toThrow(AccessConfigError);
  });
});
