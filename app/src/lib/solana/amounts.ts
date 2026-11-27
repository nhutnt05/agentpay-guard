import { U64_MAX } from "@/lib/anchor/constants";

// Token amounts are bigint in logic and decimal/base-unit STRINGS in JSON. Never `number`
// (precision loss above 2^53) and never floating point (docs/11 §3.1, AI_CODING_GUIDE §4).

/**
 * Converts a human decimal string ("5", "0.000001") to base units for `decimals`.
 * Rejects signs, exponents, separators, empty parts, more fractional digits than
 * `decimals`, and values above u64.
 */
export function parseDecimalAmount(value: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 19) {
    throw new RangeError("decimals must be an integer in [0, 19]");
  }
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) throw new Error(`invalid decimal amount '${value}'`);
  const [, whole, fraction = ""] = m;
  if (fraction.length > decimals) {
    throw new Error(`amount '${value}' has more than ${decimals} fractional digits`);
  }
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  if (units > U64_MAX) throw new RangeError(`amount '${value}' exceeds u64`);
  return units;
}

/** Formats base units as a decimal string without trailing zeros ("5000000", 6 → "5"). */
export function formatBaseUnits(units: bigint, decimals: number): string {
  if (units < 0n) throw new RangeError("units must be non-negative");
  if (decimals === 0) return units.toString();
  const scale = 10n ** BigInt(decimals);
  const whole = units / scale;
  const fraction = (units % scale).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
