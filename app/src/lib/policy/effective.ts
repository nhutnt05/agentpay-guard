import { SECONDS_PER_DAY } from "@/lib/anchor/constants";

// Read-side view of the lazily-reset daily counter (docs/11 §5). The program resets
// `spent_today` only on the first SUCCESSFUL payment of a new UTC day (EP-22, EP-22c), so the
// stored value can belong to an earlier day. Clients must show the effective value.

/** UTC day index of a unix timestamp (Euclidean division, like the program). */
export function dayIndex(unixSeconds: number): number {
  return Math.floor(unixSeconds / SECONDS_PER_DAY);
}

export interface DailySpendView {
  effectiveSpentToday: bigint;
  remainingToday: bigint;
}

export function effectiveDailySpend(input: {
  spentToday: bigint;
  storedDayIndex: number;
  currentDayIndex: number;
  dailyLimit: bigint;
}): DailySpendView {
  // Newer day: counter will reset on the next payment. Same day or clock regression: keep it
  // (the program does not reset on regression, EP-22d).
  const effective = input.currentDayIndex > input.storedDayIndex ? 0n : input.spentToday;
  const remaining = input.dailyLimit > effective ? input.dailyLimit - effective : 0n;
  return { effectiveSpentToday: effective, remainingToday: remaining };
}
