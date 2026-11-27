const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Strict base58 (Bitcoin alphabet) decoding. Throws without echoing the input. */
export function base58Decode(value: string): Uint8Array {
  let n = 0n;
  for (const c of value) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error("invalid base58 string");
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n % 256n));
    n /= 256n;
  }
  for (const c of value) {
    if (c !== "1") break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}
