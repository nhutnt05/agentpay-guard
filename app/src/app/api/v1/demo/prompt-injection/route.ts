import { fail, ok } from "@/lib/api/response";
import { DemoError, DemoRequestSchema, runPromptInjectionDemo } from "@/lib/ai/demo";
import { getDemoDeps } from "@/lib/ai/demoDeps";
import { clientIp } from "@/lib/server/guards";
import { PaymentServiceError } from "@/lib/server/payments";
import { createRateLimiter } from "@/lib/server/rateLimit";

// POST /api/v1/demo/prompt-injection (docs/06 §3.10, DEMO-01). 404 unless DEMO_MODE=true.
// Runs a deliberately vulnerable agent against the malicious page and pushes its payment
// through the normal prepare/submit path; with submitOnChain the failing transaction lands
// on-chain so Explorer shows the rejection.
export const maxDuration = 60;

const demoLimiter = createRateLimiter({ capacity: 3, refillPerSecond: 0.05 });

export async function POST(request: Request) {
  if (process.env.DEMO_MODE !== "true") return fail(404, "NOT_FOUND", "not found");

  const limit = demoLimiter.take(`demo:${clientIp(request)}`);
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
  const parsed = DemoRequestSchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "invalid request body", parsed.error.issues);

  try {
    return ok(await runPromptInjectionDemo(getDemoDeps(), parsed.data));
  } catch (e) {
    if (e instanceof DemoError || e instanceof PaymentServiceError) {
      return Response.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    }
    return fail(502, "RPC_ERROR", "demo failed while talking to the cluster");
  }
}
