import { z } from "zod";

// F-01 x402 v2 wire formats (specs/x402-specification-v2.md, transports-v2/http.md and
// schemes/exact/scheme_exact_svm.md in github.com/coinbase/x402, read 2026-11-28; docs/14 §2).
// Only what AgentPay Guard needs as a CLIENT: parse a 402, pick an `exact` Solana requirement
// that matches the policy, and encode the payment header. Pure functions, no I/O.

export const X402_VERSION = 2;
/** CAIP-2 network id of Solana devnet (x402 v2; `@x402/svm` constants). */
export const SOLANA_DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

const Base58Key = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);

export const PaymentRequirementsSchema = z
  .object({
    scheme: z.string(),
    network: z.string(),
    amount: z.string().regex(/^\d{1,20}$/),
    asset: z.string(),
    payTo: z.string(),
    maxTimeoutSeconds: z.number().int().positive(),
    extra: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type PaymentRequirements = z.infer<typeof PaymentRequirementsSchema>;

export const PaymentRequiredSchema = z
  .object({
    x402Version: z.number().int(),
    error: z.string().optional(),
    resource: z.record(z.string(), z.unknown()).optional(),
    accepts: z.array(PaymentRequirementsSchema),
    extensions: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();
export type PaymentRequired = z.infer<typeof PaymentRequiredSchema>;

export const SettlementResponseSchema = z
  .object({
    success: z.boolean(),
    transaction: z.string().optional(),
    network: z.string().optional(),
    payer: z.string().optional(),
    errorReason: z.string().optional(),
  })
  .passthrough();
export type SettlementResponse = z.infer<typeof SettlementResponseSchema>;

const b64json = (value: unknown) => Buffer.from(JSON.stringify(value), "utf8").toString("base64");
const fromB64json = (header: string): unknown => JSON.parse(Buffer.from(header, "base64").toString("utf8"));

export class X402ProtocolError extends Error {}

/** Reads `PaymentRequired` from a 402 response: the base64 `PAYMENT-REQUIRED` header, else the JSON body. */
export function decodePaymentRequired(headers: Headers, body: unknown): PaymentRequired {
  const header = headers.get(HEADER_PAYMENT_REQUIRED);
  let raw: unknown = body;
  if (header) {
    try {
      raw = fromB64json(header);
    } catch {
      throw new X402ProtocolError("PAYMENT-REQUIRED header is not base64 JSON");
    }
  }
  const parsed = PaymentRequiredSchema.safeParse(raw);
  if (!parsed.success) throw new X402ProtocolError("402 response has no valid x402 PaymentRequired object");
  if (parsed.data.x402Version !== X402_VERSION) {
    throw new X402ProtocolError(`unsupported x402Version ${parsed.data.x402Version} (need ${X402_VERSION})`);
  }
  return parsed.data;
}

export interface SelectedRequirement {
  requirement: PaymentRequirements;
  feePayer: string;
  memo: string | null;
  recentBlockhash: string | null;
}

/**
 * Picks the requirement AgentPay Guard can pay: scheme `exact`, Solana devnet, asset == the
 * policy mint, with a sponsor `extra.feePayer`. The amount is NOT checked here — limits are the
 * program's job (it rejects on-chain / in simulation like any other payment).
 */
export function selectRequirement(pr: PaymentRequired, policyMint: string): SelectedRequirement {
  const reasons: string[] = [];
  for (const r of pr.accepts) {
    if (r.scheme !== "exact") {
      reasons.push(`scheme ${r.scheme}`);
      continue;
    }
    if (r.network !== SOLANA_DEVNET_CAIP2) {
      reasons.push(`network ${r.network}`);
      continue;
    }
    if (r.asset !== policyMint) {
      reasons.push(`asset ${r.asset} is not the policy mint`);
      continue;
    }
    const extra = r.extra ?? {};
    const feePayer = typeof extra.feePayer === "string" ? extra.feePayer : "";
    if (!Base58Key.safeParse(feePayer).success || !Base58Key.safeParse(r.payTo).success) {
      reasons.push("missing/invalid feePayer or payTo");
      continue;
    }
    const memo = typeof extra.memo === "string" ? extra.memo : null;
    const blockhash = typeof extra.recentBlockhash === "string" ? extra.recentBlockhash : null;
    return {
      requirement: r,
      feePayer,
      memo,
      recentBlockhash: blockhash && Base58Key.safeParse(blockhash).success ? blockhash : null,
    };
  }
  throw new X402ProtocolError(`no payable requirement (${reasons.join("; ") || "accepts is empty"})`);
}

/** `PAYMENT-SIGNATURE` header value: base64 JSON PaymentPayload with the partially signed tx. */
export function encodePaymentSignature(pr: PaymentRequired, requirement: PaymentRequirements, transactionBase64: string) {
  return b64json({
    x402Version: X402_VERSION,
    ...(pr.resource ? { resource: pr.resource } : {}),
    accepted: requirement,
    payload: { transaction: transactionBase64 },
  });
}

/** Decodes the optional `PAYMENT-RESPONSE` settlement header (null when absent or invalid). */
export function decodePaymentResponse(headers: Headers): SettlementResponse | null {
  const header = headers.get(HEADER_PAYMENT_RESPONSE);
  if (!header) return null;
  try {
    const parsed = SettlementResponseSchema.safeParse(fromB64json(header));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Random 16-byte hex nonce for the Memo when the seller sets no `extra.memo` (spec: uniqueness). */
export function randomMemoNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
