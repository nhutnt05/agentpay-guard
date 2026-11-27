import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rateLimit";

describe("token-bucket rate limiter", () => {
  it("allows a burst up to capacity, then refuses with a retry hint", () => {
    const rl = createRateLimiter({ capacity: 3, refillPerSecond: 1 });
    const t = 1_000_000;
    expect([rl.take("ip", t), rl.take("ip", t), rl.take("ip", t)].every((r) => r.allowed)).toBe(true);
    const denied = rl.take("ip", t);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBe(1000);
  });

  it("refills over time and caps at capacity", () => {
    const rl = createRateLimiter({ capacity: 2, refillPerSecond: 2 });
    const t = 0;
    rl.take("k", t);
    rl.take("k", t);
    expect(rl.take("k", t).allowed).toBe(false);
    expect(rl.take("k", t + 500).allowed).toBe(true); // +1 token after 0.5 s
    expect(rl.take("k", t + 60_000).allowed).toBe(true);
    expect(rl.take("k", t + 60_000).allowed).toBe(true);
    expect(rl.take("k", t + 60_000).allowed).toBe(false); // capped at 2
  });

  it("keys are independent and the key table is bounded", () => {
    const rl = createRateLimiter({ capacity: 1, refillPerSecond: 1, maxKeys: 2 });
    expect(rl.take("a", 0).allowed).toBe(true);
    expect(rl.take("a", 0).allowed).toBe(false);
    expect(rl.take("b", 0).allowed).toBe(true);
    expect(rl.take("c", 0).allowed).toBe(true); // evicts "a"
    expect(rl.take("a", 0).allowed).toBe(true); // "a" starts fresh after eviction
  });

  it("rejects invalid configuration", () => {
    expect(() => createRateLimiter({ capacity: 0, refillPerSecond: 1 })).toThrow(RangeError);
  });
});
