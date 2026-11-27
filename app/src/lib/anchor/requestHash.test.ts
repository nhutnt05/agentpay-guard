import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { bytesToHex, hexToBytes } from "@/lib/encoding/hex";
import {
  computeRequestHash,
  encodeRequestPreimage,
  newRequestId,
  type RequestHashInput,
} from "./requestHash";

// H-01: reproduces the spec vector of docs/11 §3.2, which the Rust program's unit test
// U-01 also reproduces — so both sides of the hash are byte-compatible.
const key = (byte: number) => new PublicKey(new Uint8Array(32).fill(byte));

const VECTOR: RequestHashInput = {
  policy: key(0x11),
  agent: key(0x22),
  merchant: key(0x33),
  mint: key(0x44),
  amount: 5_000_000n,
  requestId: hexToBytes("0102030405060708090a0b0c0d0e0f10", 16),
  expiresAt: 1_800_000_000n,
};

const EXPECTED_PREIMAGE =
  "4147454e545041595f47554152445f5041594d454e545f5631" +
  "11".repeat(32) +
  "22".repeat(32) +
  "33".repeat(32) +
  "44".repeat(32) +
  "404b4c0000000000" +
  "0102030405060708090a0b0c0d0e0f10" +
  "00d2496b00000000";

const EXPECTED_HASH = "f8e5a3ca0aa977f4fb97ddb7bbe5cb78e2af5d6942a3dbfc202076fc068903c5";

describe("canonical request hash (H-01)", () => {
  it("encodes the 185-byte preimage exactly as specified", () => {
    const preimage = encodeRequestPreimage(VECTOR);
    expect(preimage.length).toBe(185);
    expect(bytesToHex(preimage)).toBe(EXPECTED_PREIMAGE);
  });

  it("reproduces the spec hash vector", () => {
    expect(bytesToHex(computeRequestHash(VECTOR))).toBe(EXPECTED_HASH);
  });

  it("changes when any single field changes", () => {
    const base = bytesToHex(computeRequestHash(VECTOR));
    const rid = VECTOR.requestId.slice();
    rid[15] ^= 1;
    const variants: RequestHashInput[] = [
      { ...VECTOR, policy: key(0x55) },
      { ...VECTOR, agent: key(0x55) },
      { ...VECTOR, merchant: key(0x55) },
      { ...VECTOR, mint: key(0x55) },
      { ...VECTOR, amount: VECTOR.amount + 1n },
      { ...VECTOR, requestId: rid },
      { ...VECTOR, expiresAt: VECTOR.expiresAt + 1n },
    ];
    for (const v of variants) {
      expect(bytesToHex(computeRequestHash(v))).not.toBe(base);
    }
  });

  it("encodes u64/i64 boundaries and rejects out-of-range values", () => {
    expect(() => encodeRequestPreimage({ ...VECTOR, amount: 18_446_744_073_709_551_615n })).not.toThrow();
    expect(() => encodeRequestPreimage({ ...VECTOR, amount: 18_446_744_073_709_551_616n })).toThrow(RangeError);
    expect(() => encodeRequestPreimage({ ...VECTOR, amount: -1n })).toThrow(RangeError);
    expect(() => encodeRequestPreimage({ ...VECTOR, expiresAt: 9_223_372_036_854_775_808n })).toThrow(RangeError);
    // Negative i64 is two's complement little-endian.
    const negative = encodeRequestPreimage({ ...VECTOR, expiresAt: -1n });
    expect(bytesToHex(negative.slice(177))).toBe("ff".repeat(8));
  });

  it("rejects a request id that is not 16 bytes", () => {
    expect(() => encodeRequestPreimage({ ...VECTOR, requestId: new Uint8Array(15) })).toThrow(RangeError);
  });

  it("generates random 16-byte request ids", () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a.length).toBe(16);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });
});
