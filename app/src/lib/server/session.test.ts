import { createPrivateKey, sign } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSignInChallenge,
  NONCE_TTL_MS,
  ownerSessionFor,
  readSessionWallet,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  SessionConfigError,
  SignInError,
  verifySignIn,
} from "./session";

// T-M4-16 sign-in. Signatures are real ed25519 signatures over the message bytes, the same
// format Phantom's signMessage returns.

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
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

function signMessage(kp: Keypair, message: string): string {
  const key = createPrivateKey({
    key: {
      kty: "OKP",
      crv: "Ed25519",
      d: Buffer.from(kp.secretKey.slice(0, 32)).toString("base64url"),
      x: Buffer.from(kp.publicKey.toBytes()).toString("base64url"),
    },
    format: "jwk",
  });
  return base58(sign(null, Buffer.from(message, "utf8"), key));
}

const NOW = 1_800_000_000_000;
const owner = Keypair.generate();
const other = Keypair.generate();
const cookie = (token: string) => `foo=bar; ${SESSION_COOKIE}=${encodeURIComponent(token)}`;

beforeEach(() => {
  process.env.SESSION_SECRET = "test-secret-".padEnd(48, "x");
});
afterEach(() => {
  delete process.env.SESSION_SECRET;
  delete process.env.REQUIRE_OWNER_SESSION;
});

describe("sign-in with Solana (T-M4-16)", () => {
  it("valid signed challenge → session cookie that resolves to the wallet", () => {
    const c = createSignInChallenge(owner.publicKey.toBase58(), NOW);
    expect(c.message).toContain("It does not authorize any payment.");
    const s = verifySignIn({ wallet: owner.publicKey.toBase58(), message: c.message, signature: signMessage(owner, c.message) }, NOW + 1_000);
    expect(s.wallet).toBe(owner.publicKey.toBase58());
    expect(readSessionWallet(cookie(s.token), NOW + 2_000)).toBe(owner.publicKey.toBase58());
    expect(readSessionWallet(cookie(s.token), NOW + SESSION_TTL_MS + 2_000)).toBeNull(); // expired
  });

  it("rejects a signature by another key", () => {
    const c = createSignInChallenge(owner.publicKey.toBase58(), NOW);
    expect(() =>
      verifySignIn({ wallet: owner.publicKey.toBase58(), message: c.message, signature: signMessage(other, c.message) }, NOW),
    ).toThrow(/signature verification failed/);
  });

  it("rejects claiming another wallet with a challenge issued for someone else", () => {
    const c = createSignInChallenge(owner.publicKey.toBase58(), NOW);
    const forged = c.message.replace(owner.publicKey.toBase58(), other.publicKey.toBase58());
    expect(() =>
      verifySignIn({ wallet: other.publicKey.toBase58(), message: forged, signature: signMessage(other, forged) }, NOW),
    ).toThrow(/invalid nonce/);
    expect(() =>
      verifySignIn({ wallet: other.publicKey.toBase58(), message: c.message, signature: signMessage(other, c.message) }, NOW),
    ).toThrow(/does not match/);
  });

  it("rejects tampered nonce, edited issuedAt, expired nonce and foreign messages", () => {
    const w = owner.publicKey.toBase58();
    const c = createSignInChallenge(w, NOW);
    const tamperedNonce = c.message.replace(c.nonce, c.nonce.slice(0, -2) + (c.nonce.endsWith("AA") ? "BB" : "AA"));
    const editedTime = c.message.replace(c.issuedAt, new Date(NOW + 1).toISOString());
    for (const [msg, at, re] of [
      [tamperedNonce, NOW, /invalid nonce/],
      [editedTime, NOW, /issuedAt/],
      [c.message, NOW + NONCE_TTL_MS + 1, /expired/],
      ["Please sign to claim your airdrop", NOW, /not an AgentPay Guard/],
    ] as const) {
      expect(() => verifySignIn({ wallet: w, message: msg, signature: signMessage(owner, msg) }, at)).toThrow(re);
    }
  });

  it("forged or tampered session cookies are ignored", () => {
    const c = createSignInChallenge(owner.publicKey.toBase58(), NOW);
    const s = verifySignIn({ wallet: owner.publicKey.toBase58(), message: c.message, signature: signMessage(owner, c.message) }, NOW);
    const [body, tag] = s.token.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ w: other.publicKey.toBase58(), exp: NOW + 1e9 })).toString("base64url");
    expect(readSessionWallet(cookie(`${forgedBody}.${tag}`), NOW)).toBeNull();
    expect(readSessionWallet(cookie(`${body}.AAAA`), NOW)).toBeNull();
    expect(readSessionWallet(null, NOW)).toBeNull();
  });

  it("fails closed without SESSION_SECRET", () => {
    delete process.env.SESSION_SECRET;
    expect(() => createSignInChallenge(owner.publicKey.toBase58(), NOW)).toThrow(SessionConfigError);
    process.env.REQUIRE_OWNER_SESSION = "true";
    expect(() => ownerSessionFor(new Request("http://x"))).toThrow(SessionConfigError);
  });

  it("errors are SignInError for bad input", () => {
    expect(() => verifySignIn({ wallet: "nope", message: "x", signature: "y" }, NOW)).toThrow(SignInError);
  });
});
