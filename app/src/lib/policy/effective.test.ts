import { describe, expect, it } from "vitest";
import { dayIndex, effectiveDailySpend } from "./effective";

// Mirrors the on-chain behavior proven by EP-22…EP-22e (docs/11 §5).
const DAY = 20_833;
const base = { spentToday: 20_000_000n, storedDayIndex: DAY, dailyLimit: 20_000_000n };

describe("effective daily spend", () => {
  it("same day: stored counter applies", () => {
    expect(effectiveDailySpend({ ...base, currentDayIndex: DAY })).toEqual({
      effectiveSpentToday: 20_000_000n,
      remainingToday: 0n,
    });
  });

  it("new day with a stale stored counter (EP-22c): effective spend is 0", () => {
    expect(effectiveDailySpend({ ...base, currentDayIndex: DAY + 1 })).toEqual({
      effectiveSpentToday: 0n,
      remainingToday: 20_000_000n,
    });
  });

  it("clock regression (EP-22d): no reset", () => {
    expect(effectiveDailySpend({ ...base, currentDayIndex: DAY - 1 }).effectiveSpentToday).toBe(20_000_000n);
  });

  it("remaining saturates at 0 when the limit was lowered below spending (UP-05)", () => {
    expect(effectiveDailySpend({ ...base, dailyLimit: 6_000_000n, currentDayIndex: DAY }).remainingToday).toBe(0n);
  });

  it("dayIndex matches the program's UTC day (exact midnight boundary, EP-22b)", () => {
    const midnight = (DAY + 1) * 86_400;
    expect(dayIndex(midnight - 1)).toBe(DAY);
    expect(dayIndex(midnight)).toBe(DAY + 1);
    expect(dayIndex(-1)).toBe(-1);
  });
});
