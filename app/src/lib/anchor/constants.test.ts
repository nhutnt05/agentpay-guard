import { describe, expect, it } from "vitest";
import {
  checkProgramIdConfig,
  MAX_REQUEST_TTL_SECONDS,
  PROGRAM_ID,
  REQUEST_HASH_DOMAIN,
  SECONDS_PER_DAY,
  SEED_MERCHANT,
  SEED_POLICY,
  SEED_RECEIPT,
} from "./constants";
import idl from "./idl/agent_payment_firewall.json";

// The TS constants must equal the program's `#[constant]` values exported in the IDL.
const idlConst = (name: string) => {
  const c = idl.constants.find((x) => x.name === name);
  if (!c) throw new Error(`IDL constant ${name} missing`);
  return c;
};
const idlBytes = (name: string) => Uint8Array.from(JSON.parse(idlConst(name).value) as number[]);

describe("anchor constants mirror the program", () => {
  it("program id is the IDL address", () => {
    expect(PROGRAM_ID.toBase58()).toBe(idl.address);
  });

  it("seeds and hash domain equal the IDL byte constants", () => {
    expect(SEED_POLICY).toEqual(idlBytes("SEED_POLICY"));
    expect(SEED_MERCHANT).toEqual(idlBytes("SEED_MERCHANT"));
    expect(SEED_RECEIPT).toEqual(idlBytes("SEED_RECEIPT"));
    expect(REQUEST_HASH_DOMAIN).toEqual(idlBytes("REQUEST_HASH_DOMAIN"));
    expect(REQUEST_HASH_DOMAIN.length).toBe(25);
  });

  it("time constants equal the IDL values", () => {
    expect(SECONDS_PER_DAY).toBe(Number(idlConst("SECONDS_PER_DAY").value));
    expect(MAX_REQUEST_TTL_SECONDS).toBe(Number(idlConst("MAX_REQUEST_TTL_SECONDS").value));
  });

  it("checkProgramIdConfig detects a mismatched NEXT_PUBLIC_PROGRAM_ID", () => {
    expect(checkProgramIdConfig(idl.address).ok).toBe(true);
    expect(checkProgramIdConfig("11111111111111111111111111111111").ok).toBe(false);
    expect(checkProgramIdConfig(undefined)).toMatchObject({ ok: false, configuredProgramId: null });
  });
});
