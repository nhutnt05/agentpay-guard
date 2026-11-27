import "server-only";

// Best-effort in-memory token bucket (docs/06 §2). On serverless platforms each instance
// has its own memory, so limits are per instance — a documented limitation, not a security
// boundary. The on-chain policy limits are the real spending bound.

export interface RateLimitResult {
  allowed: boolean;
  /** Milliseconds until one token is available again (0 when allowed). */
  retryAfterMs: number;
}

export interface RateLimiter {
  take(key: string, now?: number): RateLimitResult;
}

export function createRateLimiter(options: {
  /** Burst size. */
  capacity: number;
  /** Tokens added per second. */
  refillPerSecond: number;
  /** Max tracked keys; least-recently-created keys are evicted beyond this. */
  maxKeys?: number;
}): RateLimiter {
  const { capacity, refillPerSecond, maxKeys = 10_000 } = options;
  if (capacity <= 0 || refillPerSecond <= 0) throw new RangeError("capacity and refill must be > 0");
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();

  return {
    take(key, now = Date.now()) {
      let bucket = buckets.get(key);
      if (!bucket) {
        if (buckets.size >= maxKeys) {
          const oldest = buckets.keys().next().value;
          if (oldest !== undefined) buckets.delete(oldest);
        }
        bucket = { tokens: capacity, updatedAt: now };
        buckets.set(key, bucket);
      }
      const elapsed = Math.max(0, now - bucket.updatedAt) / 1000;
      bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerSecond);
      bucket.updatedAt = now;

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true, retryAfterMs: 0 };
      }
      return {
        allowed: false,
        retryAfterMs: Math.ceil(((1 - bucket.tokens) / refillPerSecond) * 1000),
      };
    },
  };
}
