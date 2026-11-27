import { describe, expect, it } from "vitest";
import {
  AmountSchema,
  HashSchema,
  PolicyRouteParamsSchema,
  PubkeySchema,
  RequestIdSchema,
  SignatureSchema,
} from "./common";

// API-01: Zod rejects malformed public keys, amounts, request ids, hashes and signatures.
const PROGRAM = "GvjcbQ2g7dg6ZNNBffhyVLmSz8ncbaEvL2c4M1Esayza";
// A real devnet signature (program deploy, docs/evidence/DEVNET_EVIDENCE.md).
const SIG = "3UxD5ioRCisM8Q3Lh6MANPZAWzhaiDgH4AmXTACHmUos5eVwCU9gbxGHbefdsvd1UMMjrTFpp1QCtPijxCnEzWye";

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe("validation schemas (API-01)", () => {
  it("PubkeySchema", () => {
    expect(ok(PubkeySchema, PROGRAM)).toBe(true);
    expect(ok(PubkeySchema, "11111111111111111111111111111111")).toBe(true);
    for (const bad of ["", "abc", `${PROGRAM}x`, PROGRAM.replace("G", "0"), " " + PROGRAM, 42, null]) {
      expect(ok(PubkeySchema, bad), String(bad)).toBe(false);
    }
  });

  it("AmountSchema: positive base-unit integer strings within u64", () => {
    for (const good of ["1", "5000000", "18446744073709551615"]) {
      expect(ok(AmountSchema, good), good).toBe(true);
    }
    for (const bad of ["0", "-1", "01", "1.5", "1e6", " 1", "18446744073709551616", "", 5]) {
      expect(ok(AmountSchema, bad), String(bad)).toBe(false);
    }
  });

  it("RequestIdSchema / HashSchema: exact-length lower-case hex", () => {
    expect(ok(RequestIdSchema, "0102030405060708090a0b0c0d0e0f10")).toBe(true);
    expect(ok(RequestIdSchema, "0102030405060708090A0B0C0D0E0F10")).toBe(false);
    expect(ok(RequestIdSchema, "0102")).toBe(false);
    expect(ok(HashSchema, "f8e5a3ca0aa977f4fb97ddb7bbe5cb78e2af5d6942a3dbfc202076fc068903c5")).toBe(true);
    expect(ok(HashSchema, "zz".repeat(32))).toBe(false);
  });

  it("SignatureSchema", () => {
    expect(ok(SignatureSchema, SIG)).toBe(true);
    expect(ok(SignatureSchema, SIG.slice(0, 40))).toBe(false);
    expect(ok(SignatureSchema, SIG.replace("3", "0"))).toBe(false);
  });

  it("policy route param is a public key", () => {
    expect(ok(PolicyRouteParamsSchema, { policyId: PROGRAM })).toBe(true);
    expect(ok(PolicyRouteParamsSchema, { policyId: "not-a-key" })).toBe(false);
  });
});
