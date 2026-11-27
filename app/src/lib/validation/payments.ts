import { z } from "zod";
import { MAX_REQUEST_TTL_SECONDS } from "@/lib/anchor/constants";
import { AmountSchema, HashSchema, PubkeySchema, RequestIdSchema } from "./common";

// Request bodies of /api/v1/payments/* (docs/06 §3.4–3.5). `.strict()` rejects unknown keys,
// so a client cannot smuggle extra fields (e.g. an "owner" or serialized transaction).

export const PrepareRequestSchema = z
  .object({
    policy: PubkeySchema,
    merchant: PubkeySchema,
    amount: AmountSchema,
    /** Reuse an existing id to retry the SAME request idempotently (docs/11 §4). */
    requestId: RequestIdSchema.optional(),
    expiresInSeconds: z.number().int().min(30).max(MAX_REQUEST_TTL_SECONDS).default(300),
  })
  .strict();
export type PrepareRequest = z.infer<typeof PrepareRequestSchema>;

export const SubmitRequestSchema = z
  .object({
    policy: PubkeySchema,
    merchant: PubkeySchema,
    amount: AmountSchema,
    requestId: RequestIdSchema,
    /** Unix seconds, as returned by /prepare. */
    expiresAt: z.number().int().positive(),
    requestHash: HashSchema,
    /** Demo only (DEMO_MODE=true): land a failing transaction on-chain as evidence. */
    demoForceSubmit: z.boolean().default(false),
  })
  .strict();
export type SubmitRequest = z.infer<typeof SubmitRequestSchema>;
