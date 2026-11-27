import { Keypair, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { AgentKeyConfigError, parseAgentSecretKey } from "./agentKeypair";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = B58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = "1" + out;
  }
  return out;
}

/** Signs a real transaction and verifies the signature — proves the key is usable. */
function signsCorrectly(kp: Keypair): boolean {
  const tx = new Transaction({
    feePayer: kp.publicKey,
    recentBlockhash: new PublicKey(new Uint8Array(32).fill(9)).toBase58(),
  }).add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: kp.publicKey, lamports: 1 }));
  tx.sign(kp);
  return tx.verifySignatures();
}

describe("agent secret key parsing", () => {
  const original = Keypair.generate();

  it("accepts the Solana CLI JSON byte-array format", () => {
    const kp = parseAgentSecretKey(JSON.stringify(Array.from(original.secretKey)));
    expect(kp.publicKey.equals(original.publicKey)).toBe(true);
    expect(signsCorrectly(kp)).toBe(true);
  });

  it("accepts base58 and tolerates surrounding whitespace", () => {
    const kp = parseAgentSecretKey(`  ${base58Encode(original.secretKey)}\n`);
    expect(kp.publicKey.equals(original.publicKey)).toBe(true);
    expect(signsCorrectly(kp)).toBe(true);
  });

  it("rejects missing, malformed, wrong-length and inconsistent keys", () => {
    const tampered = Array.from(original.secretKey);
    tampered[40] ^= 1; // public half no longer matches the secret half
    for (const bad of [
      undefined,
      "",
      "[1,2,3",
      "[1,2,300]",
      JSON.stringify(Array.from(original.secretKey.slice(0, 32))),
      JSON.stringify(tampered),
      "0OIl-not-base58",
    ]) {
      expect(() => parseAgentSecretKey(bad), String(bad).slice(0, 20)).toThrow(AgentKeyConfigError);
    }
  });

  it("never echoes the secret in error messages", () => {
    const secret = base58Encode(original.secretKey).slice(0, 40) + "0"; // invalid char at end
    try {
      parseAgentSecretKey(secret);
      expect.unreachable();
    } catch (e) {
      expect(String((e as Error).message)).not.toContain(secret.slice(0, 10));
    }
  });
});
