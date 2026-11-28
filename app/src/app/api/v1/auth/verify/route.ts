import { z } from "zod";
import { fail } from "@/lib/api/response";
import { clientIp } from "@/lib/server/guards";
import { createRateLimiter } from "@/lib/server/rateLimit";
import { SessionConfigError, SignInError, sessionCookie, verifySignIn } from "@/lib/server/session";
import { PubkeySchema } from "@/lib/validation/common";

// POST /api/v1/auth/verify (T-M4-16): verifies the signed sign-in message and sets an
// HttpOnly, SameSite=Lax session cookie (Secure on HTTPS). Body: { wallet, message, signature(base58) }.

const BodySchema = z
  .object({ wallet: PubkeySchema, message: z.string().min(1).max(2_000), signature: z.string().min(64).max(100) })
  .strict();
const limiter = createRateLimiter({ capacity: 10, refillPerSecond: 0.2 });

export async function POST(request: Request) {
  const limit = limiter.take(`auth-verify:${clientIp(request)}`);
  if (!limit.allowed) return fail(429, "RATE_LIMITED", "too many requests");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, "VALIDATION_ERROR", "body must be JSON");
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "invalid request body", parsed.error.issues);

  try {
    const session = verifySignIn(parsed.data);
    const secure = new URL(request.url).protocol === "https:";
    return Response.json(
      { ok: true, data: { wallet: session.wallet, expiresAt: session.expiresAt } },
      { headers: { "set-cookie": sessionCookie(session.token, secure) } },
    );
  } catch (e) {
    if (e instanceof SignInError) return fail(401, "SIGN_IN_FAILED", e.message);
    if (e instanceof SessionConfigError) return fail(500, "CONFIG_ERROR", e.message);
    throw e;
  }
}
