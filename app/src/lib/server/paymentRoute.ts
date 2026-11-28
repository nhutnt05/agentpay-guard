import "server-only";
import type { z } from "zod";
import { fail } from "@/lib/api/response";
import { AccessConfigError } from "./access";
import { AgentKeyConfigError } from "./agentKeypair";
import { clientIp } from "./guards";
import { getPaymentDeps } from "./paymentDeps";
import { type PaymentDeps, type PaymentResult, PaymentServiceError } from "./payments";
import { SessionConfigError } from "./session";
import { createRateLimiter } from "./rateLimit";

// Shared plumbing for the POST payment routes: rate limit, JSON + Zod parsing, error mapping.

// Stricter than reads: each call may sign and spend (bounded on-chain by the policy).
const writeLimiter = createRateLimiter({ capacity: 5, refillPerSecond: 0.2 });

/** Payment results use the envelope with `ok` reflecting success and `data` carrying details. */
export function paymentResponse(result: PaymentResult): Response {
  const { httpStatus, ...data } = result;
  const okStatus = data.status === "READY_TO_SIGN" || data.status === "SUBMITTED" || data.status === "CONFIRMED";
  return Response.json(
    okStatus
      ? { ok: true, data }
      : { ok: false, error: { code: data.reason ?? data.status, message: data.message ?? data.status }, data },
    { status: httpStatus },
  );
}

export async function handlePaymentPost<S extends z.ZodType>(
  request: Request,
  scope: string,
  schema: S,
  run: (deps: PaymentDeps, input: z.infer<S>) => Promise<PaymentResult>,
): Promise<Response> {
  const limit = writeLimiter.take(`${scope}:${clientIp(request)}`);
  if (!limit.allowed) {
    return fail(429, "RATE_LIMITED", "too many requests", undefined, {
      "retry-after": String(Math.ceil(limit.retryAfterMs / 1000)),
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "VALIDATION_ERROR", "body must be JSON");
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "invalid request body", parsed.error.issues);

  try {
    return paymentResponse(await run(getPaymentDeps(request), parsed.data));
  } catch (e) {
    if (e instanceof PaymentServiceError) {
      return Response.json(
        { ok: false, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } },
        { status: e.httpStatus },
      );
    }
    if (e instanceof AccessConfigError) return fail(500, "CONFIG_ERROR", "server access configuration is invalid");
    if (e instanceof AgentKeyConfigError || e instanceof SessionConfigError) return fail(500, "CONFIG_ERROR", e.message);
    return fail(502, "RPC_ERROR", "payment request failed while talking to the cluster");
  }
}
