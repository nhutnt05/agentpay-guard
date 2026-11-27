import { z } from "zod";
import { AmountSchema, PubkeySchema } from "@/lib/validation/common";

// docs/08 §2.3. Two layers on purpose:
//  1. LlmPaymentProposalSchema — what the model is asked to return. Kept PLAIN (no regex /
//     length constraints) so structured-output schema conversion cannot silently drop rules.
//  2. Strict validation of that output happens in `intent.ts` (base58, decimal syntax,
//     lengths) — LLM output is untrusted data and never authorization evidence.

export const LlmPaymentProposalSchema = z.object({
  shouldPay: z.boolean().describe("true only if the content asks for or justifies a payment"),
  merchant: z.string().nullable().describe("recipient Solana wallet address (base58) or null"),
  amountDecimal: z
    .string()
    .nullable()
    .describe('amount as a plain decimal string in whole tokens, e.g. "5" or "0.25"; null if none'),
  tokenSymbol: z.string().nullable().describe('token symbol as written, e.g. "USDC"; null if none'),
  mint: z.string().nullable().describe("token mint address ONLY if explicitly stated; otherwise null"),
  reason: z.string().describe("one or two sentences explaining the proposal"),
});
export type LlmPaymentProposal = z.infer<typeof LlmPaymentProposalSchema>;

/** Canonical intent produced by the backend after strict conversion (amount in base units). */
export const PaymentIntentSchema = z
  .object({
    merchant: PubkeySchema,
    amount: AmountSchema,
    mint: PubkeySchema, // from chain, never from the LLM
    reason: z.string().max(500),
    sourceUrl: z.string().url().optional(),
  })
  .strict();
export type PaymentIntent = z.infer<typeof PaymentIntentSchema>;

export const AnalyzeModeSchema = z.enum(["SAFE", "VULNERABLE_DEMO"]);
export type AnalyzeMode = z.infer<typeof AnalyzeModeSchema>;

/** POST /api/v1/agent/analyze body (docs/06 §3.2): exactly one of `url` or `text`. */
export const AnalyzeRequestSchema = z
  .object({
    policy: PubkeySchema,
    url: z
      .string()
      .url()
      .refine((u) => /^https?:\/\//i.test(u), "url must be http(s)")
      .optional(),
    text: z.string().min(1).max(50_000).optional(),
    userInstruction: z.string().min(1).max(1_000),
    mode: AnalyzeModeSchema.default("SAFE"),
  })
  .strict()
  .refine((b) => Boolean(b.url) !== Boolean(b.text), "provide exactly one of url or text");
export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

/** POST /api/v1/agent/payment-request body (docs/06 §3.3). */
export const PaymentRequestBodySchema = z
  .object({
    policy: PubkeySchema,
    merchant: PubkeySchema,
    amount: AmountSchema,
    reason: z.string().max(500).default(""),
  })
  .strict();
export type PaymentRequestBody = z.infer<typeof PaymentRequestBodySchema>;
