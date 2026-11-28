import "server-only";
import { PublicKey } from "@solana/web3.js";
import type { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { AccessConfigError } from "@/lib/server/access";
import { clientIp } from "@/lib/server/guards";
import { createRateLimiter, type RateLimiter } from "@/lib/server/rateLimit";
import { SessionConfigError } from "@/lib/server/session";
import { getAgentDeps } from "./agentDeps";
import { type AgentDeps, AgentServiceError } from "./analyze";

/** Shared POST plumbing for /agent/* routes: rate limit, JSON + Zod, error envelope. */
export async function handleAgentPost<S extends z.ZodType<{ policy: string }>>(
  request: Request,
  limiter: RateLimiter,
  scope: string,
  schema: S,
  run: (deps: AgentDeps, input: z.infer<S>, policy: PublicKey) => Promise<unknown>,
): Promise<Response> {
  const limit = limiter.take(`${scope}:${clientIp(request)}`);
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
    return ok(await run(getAgentDeps(request), parsed.data, new PublicKey(parsed.data.policy)));
  } catch (e) {
    if (e instanceof AgentServiceError) {
      return Response.json(
        { ok: false, error: { code: e.code, message: e.message, ...(e.details ? { details: e.details } : {}) } },
        { status: e.httpStatus },
      );
    }
    if (e instanceof AccessConfigError) return fail(500, "CONFIG_ERROR", "server access configuration is invalid");
    if (e instanceof SessionConfigError) return fail(500, "CONFIG_ERROR", e.message);
    return fail(502, "RPC_ERROR", "request failed while talking to the cluster");
  }
}

// LLM calls are billed: much stricter than reads.
export const analyzeLimiter = createRateLimiter({ capacity: 3, refillPerSecond: 0.1 });
export const paymentRequestLimiter = createRateLimiter({ capacity: 10, refillPerSecond: 1 });
