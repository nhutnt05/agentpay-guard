import { createHash, randomBytes } from "node:crypto";
import type { PublicKey } from "@solana/web3.js";
import { I64_MAX, I64_MIN, REQUEST_HASH_DOMAIN, U64_MAX } from "./constants";

// Canonical request hash (docs/11 §3). Must stay byte-compatible with
// `utils::compute_request_hash` in the program; `requestHash.test.ts` pins the spec vector.
// Server-side only (uses node:crypto): the hash is computed by the backend and in tests.

export const REQUEST_ID_LENGTH = 16;
export const PREIMAGE_LENGTH = 185;

export interface RequestHashInput {
  policy: PublicKey;
  agent: PublicKey;
  /** Merchant WALLET (the allowlisted identity), not its token account. */
  merchant: PublicKey;
  mint: PublicKey;
  /** Base units (u64). */
  amount: bigint;
  /** 16 bytes. */
  requestId: Uint8Array;
  /** Unix seconds (i64). */
  expiresAt: bigint;
}

/**
 * Fixed-width preimage:
 * domain(25) | policy(32) | agent(32) | merchant(32) | mint(32) | amount u64 LE(8)
 * | request_id(16) | expires_at i64 LE(8)  = 185 bytes.
 */
export function encodeRequestPreimage(input: RequestHashInput): Uint8Array {
  if (input.amount < 0n || input.amount > U64_MAX) {
    throw new RangeError("amount must fit in u64");
  }
  if (input.expiresAt < I64_MIN || input.expiresAt > I64_MAX) {
    throw new RangeError("expiresAt must fit in i64");
  }
  if (input.requestId.length !== REQUEST_ID_LENGTH) {
    throw new RangeError(`requestId must be ${REQUEST_ID_LENGTH} bytes`);
  }

  const out = new Uint8Array(PREIMAGE_LENGTH);
  const view = new DataView(out.buffer);
  let offset = 0;
  const put = (bytes: Uint8Array) => {
    out.set(bytes, offset);
    offset += bytes.length;
  };

  put(REQUEST_HASH_DOMAIN);
  put(input.policy.toBytes());
  put(input.agent.toBytes());
  put(input.merchant.toBytes());
  put(input.mint.toBytes());
  view.setBigUint64(offset, input.amount, true);
  offset += 8;
  put(input.requestId);
  view.setBigInt64(offset, input.expiresAt, true);
  offset += 8;

  if (offset !== PREIMAGE_LENGTH) {
    throw new Error(`preimage length ${offset} != ${PREIMAGE_LENGTH}`);
  }
  return out;
}

/** SHA-256 of the canonical preimage (32 bytes). */
export function computeRequestHash(input: RequestHashInput): Uint8Array {
  return new Uint8Array(createHash("sha256").update(encodeRequestPreimage(input)).digest());
}

/** Fresh 16-byte request id from a CSPRNG. */
export function newRequestId(): Uint8Array {
  return new Uint8Array(randomBytes(REQUEST_ID_LENGTH));
}
