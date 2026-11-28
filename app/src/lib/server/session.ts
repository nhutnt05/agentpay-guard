import "server-only";
import { createHmac, createPublicKey, randomBytes, timingSafeEqual, verify } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { base58Decode } from "@/lib/encoding/base58";

// Sign-In With Solana style owner session (T-M4-16, docs/06 §1.1). Stateless: the nonce and
// the session are HMAC-signed with SESSION_SECRET, so no database is needed.
// Flow: GET /auth/nonce?wallet=… → wallet signs the returned message → POST /auth/verify
// → HttpOnly session cookie. Payment routes then require session.wallet == policy.owner
// (on-chain) when REQUIRE_OWNER_SESSION=true.
// Limitation: nonces are not single-use (no storage); a captured (message, signature) pair
// could be replayed within NONCE_TTL to open a session for that same wallet. TLS protects it
// in transit; the signature never authorizes a payment by itself.

export const SESSION_COOKIE = "agp_session";
export const NONCE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 8 * 60 * 60_000;
const MESSAGE_TITLE = "AgentPay Guard sign-in";
const MESSAGE_NOTICE = "This signature proves wallet ownership. It does not authorize any payment.";

export class SessionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConfigError";
  }
}
export class SignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SignInError";
  }
}

function secret(): Buffer {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new SessionConfigError("SESSION_SECRET must be set (at least 32 characters)");
  return Buffer.from(s, "utf8");
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

function sign(payload: object): string {
  const body = b64url(JSON.stringify(payload));
  return `${body}.${mac(body)}`;
}

function unsign<T>(token: string): T | null {
  const [body, tag] = token.split(".");
  if (!body || !tag) return null;
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(tag);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

/** The exact text the wallet signs (line-based, no free-form fields). */
export function buildSignInMessage(wallet: string, nonce: string, issuedAt: string): string {
  return [MESSAGE_TITLE, `wallet: ${wallet}`, `nonce: ${nonce}`, `issuedAt: ${issuedAt}`, "cluster: devnet", MESSAGE_NOTICE].join(
    "\n",
  );
}

/** Issues a nonce bound to `wallet` and returns the message to sign. */
export function createSignInChallenge(wallet: string, now = Date.now()) {
  const key = new PublicKey(wallet).toBase58(); // throws on invalid keys
  const issuedAt = new Date(now).toISOString();
  const nonce = sign({ w: key, n: randomBytes(16).toString("hex"), iat: now });
  return { nonce, issuedAt, message: buildSignInMessage(key, nonce, issuedAt), expiresAt: new Date(now + NONCE_TTL_MS).toISOString() };
}

function ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  const key = createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: Buffer.from(publicKey).toString("base64url") },
    format: "jwk",
  });
  return verify(null, message, key, signature);
}

/**
 * Verifies a signed challenge. Returns a session token (cookie value) and its expiry.
 * `signature` is base58 (as Phantom's signMessage bytes encoded by the client).
 */
export function verifySignIn(input: { wallet: string; message: string; signature: string }, now = Date.now()) {
  let wallet: PublicKey;
  try {
    wallet = new PublicKey(input.wallet);
  } catch {
    throw new SignInError("invalid wallet");
  }
  const lines = input.message.split("\n");
  const field = (i: number, name: string) => {
    const prefix = `${name}: `;
    if (!lines[i]?.startsWith(prefix)) throw new SignInError("message is not an AgentPay Guard sign-in message");
    return lines[i].slice(prefix.length);
  };
  if (lines.length !== 6 || lines[0] !== MESSAGE_TITLE || lines[5] !== MESSAGE_NOTICE) {
    throw new SignInError("message is not an AgentPay Guard sign-in message");
  }
  const msgWallet = field(1, "wallet");
  const nonce = field(2, "nonce");
  const issuedAt = field(3, "issuedAt");
  if (field(4, "cluster") !== "devnet") throw new SignInError("wrong cluster");
  if (msgWallet !== wallet.toBase58()) throw new SignInError("message wallet does not match");

  const n = unsign<{ w: string; n: string; iat: number }>(nonce);
  if (!n || n.w !== msgWallet) throw new SignInError("invalid nonce");
  if (new Date(n.iat).toISOString() !== issuedAt) throw new SignInError("issuedAt does not match the nonce");
  if (now - n.iat > NONCE_TTL_MS || n.iat - now > 60_000) throw new SignInError("nonce expired");

  let sig: Uint8Array;
  try {
    sig = base58Decode(input.signature);
  } catch {
    throw new SignInError("signature is not base58");
  }
  if (sig.length !== 64) throw new SignInError("signature must be 64 bytes");
  if (!ed25519Verify(wallet.toBytes(), Buffer.from(input.message, "utf8"), sig)) {
    throw new SignInError("signature verification failed");
  }

  const exp = now + SESSION_TTL_MS;
  return { token: sign({ w: msgWallet, exp }), wallet: msgWallet, expiresAt: new Date(exp).toISOString() };
}

/** Wallet of a valid, unexpired session cookie in `cookieHeader`, else null. */
export function readSessionWallet(cookieHeader: string | null, now = Date.now()): string | null {
  if (!cookieHeader) return null;
  const raw = cookieHeader
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  try {
    const s = unsign<{ w: string; exp: number }>(decodeURIComponent(raw));
    return s && s.exp > now ? s.w : null;
  } catch {
    return null; // e.g. SESSION_SECRET not configured
  }
}

export function sessionCookie(token: string, secure: boolean, maxAgeMs = SESSION_TTL_MS): string {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeMs / 1000)}${secure ? "; Secure" : ""}`;
}

/** Owner-session requirement for payment routes (config + the caller's session). */
export function ownerSessionFor(request: Request | undefined): { required: boolean; wallet: string | null } {
  const required = process.env.REQUIRE_OWNER_SESSION === "true";
  if (required) secret(); // fail closed with SessionConfigError when misconfigured
  return { required, wallet: request ? readSessionWallet(request.headers.get("cookie")) : null };
}
