import { describe, expect, it } from "vitest";
import { formatBaseUnits, parseDecimalAmount } from "./amounts";

describe("decimal ↔ base-unit conversion", () => {
  it("parses decimal strings exactly (AI-02 vectors)", () => {
    expect(parseDecimalAmount("5", 6)).toBe(5_000_000n);
    expect(parseDecimalAmount("0.000001", 6)).toBe(1n);
    expect(parseDecimalAmount("10.5", 6)).toBe(10_500_000n);
    expect(parseDecimalAmount("18446744073709.551615", 6)).toBe(18_446_744_073_709_551_615n);
  });

  it("rejects too many decimals, bad syntax and u64 overflow", () => {
    expect(() => parseDecimalAmount("1.2345678", 6)).toThrow(/fractional digits/);
    for (const bad of ["", ".5", "5.", "-1", "1e6", "1,000", " 1", "abc"]) {
      expect(() => parseDecimalAmount(bad, 6), bad).toThrow();
    }
    expect(() => parseDecimalAmount("18446744073709.551616", 6)).toThrow(RangeError);
  });

  it("formats base units without trailing zeros", () => {
    expect(formatBaseUnits(5_000_000n, 6)).toBe("5");
    expect(formatBaseUnits(1n, 6)).toBe("0.000001");
    expect(formatBaseUnits(10_500_000n, 6)).toBe("10.5");
    expect(formatBaseUnits(0n, 6)).toBe("0");
    expect(formatBaseUnits(42n, 0)).toBe("42");
  });

  it("round-trips", () => {
    for (const s of ["0.000001", "1", "123.456789", "100"]) {
      expect(formatBaseUnits(parseDecimalAmount(s, 6), 6)).toBe(s);
    }
  });
});
