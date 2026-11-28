import { describe, expect, it } from "vitest";
import { createApiClient } from "@/lib/client/api";
import { SCENARIO_ORDER, SCENARIOS, type ScenarioOutcome } from "./scenarios";

// OPT-IN live run of the six Security Demo scenarios against a running server on devnet
// (T-M4-12 acceptance). Skipped unless E2E_BASE_URL is set. Spends devnet SOL/tokens.
//
//   E2E_BASE_URL=http://localhost:3000 E2E_POLICY=<policy> E2E_MERCHANT=<allowlisted>
//   E2E_ATTACKER=<non-allowlisted> E2E_FORCE_ONCHAIN=true pnpm test scenarios.devnet
// Optional: E2E_SCENARIOS=EMERGENCY_PAUSE (comma list) and E2E_EXPECT_PAUSED=true after the
// owner paused the policy. (While paused, a non-allowlisted merchant still fails on the
// missing allowlist account first — Anchor validates accounts before constraints — so the
// paused pass only runs EMERGENCY_PAUSE.)

const base = process.env.E2E_BASE_URL;
const expectPaused = process.env.E2E_EXPECT_PAUSED === "true";
const only = process.env.E2E_SCENARIOS?.split(",").map((s) => s.trim());
const selected = SCENARIO_ORDER.filter((id) => !only || only.includes(id));

describe.skipIf(!base)("security demo scenarios on devnet (live)", () => {
  const results: ScenarioOutcome[] = [];
  const api = createApiClient(base);

  it.each(selected)("%s", async (id) => {
    const policy = await api.policy(process.env.E2E_POLICY!);
    expect(policy.ok, JSON.stringify(policy.error)).toBe(true);
    const outcome = await SCENARIOS[id].run({
      api,
      policy: process.env.E2E_POLICY!,
      merchant: process.env.E2E_MERCHANT!,
      attacker: process.env.E2E_ATTACKER!,
      amount: process.env.E2E_AMOUNT ?? "1000000",
      maxPerTx: policy.data!.maxPerTx,
      forceOnChain: process.env.E2E_FORCE_ONCHAIN === "true",
      agentMode: "SCRIPTED",
    });
    results.push(outcome);
    console.log(
      `[${id}] ${outcome.actual.status} evidence=${outcome.actual.evidence} reason=${outcome.actual.reason} ` +
        `sig=${outcome.actual.signature ?? "-"} expected=${outcome.expected.status}/${outcome.expected.reason ?? "-"} ` +
        `match=${outcome.matchesExpectation} vault ${outcome.before?.vaultBalance}→${outcome.after?.vaultBalance}`,
    );
    if (id === "EMERGENCY_PAUSE" && !expectPaused) {
      expect(outcome.actual.status).toBe("NEEDS_OWNER_ACTION");
    } else {
      expect(outcome.matchesExpectation, JSON.stringify(outcome.actual)).toBe(true);
    }
  }, 120_000);
});
