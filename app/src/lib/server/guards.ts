import "server-only";
import { fail } from "@/lib/api/response";
import { createRateLimiter } from "./rateLimit";

// Per-IP rate limit for read routes. Best effort (per serverless instance, docs/06 §2).
const readLimiter = createRateLimiter({ capacity: 30, refillPerSecond: 2 });

/** Client IP from the proxy header (Vercel sets x-forwarded-for); "unknown" otherwise. */
export function clientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Returns a 429 response when the caller exceeded the read limit, otherwise null. */
export function rateLimitRead(request: Request, scope: string): Response | null {
  const result = readLimiter.take(`${scope}:${clientIp(request)}`);
  if (result.allowed) return null;
  return fail(429, "RATE_LIMITED", "too many requests", undefined, {
    "retry-after": String(Math.ceil(result.retryAfterMs / 1000)),
  });
}
