import { describe, expect, it } from "vitest";
import type { AnyData, ApiClient, ApiResponse } from "@/lib/client/api";
import { SCENARIOS, type ScenarioContext } from "./scenarios";

// Scenario logic against a scripted fake API: each scenario must report the server's status
// and evidence faithfully and compare it with the expected firewall behavior.

const SIG = "6iV1W5fuJc3ZtPiYfWDgijLJagUziewFabc4e6mhxLFBK23hpqHV4UUMr11eVSkViJgorCz7T78cr2TAgdUHcUC";
const r = (http: number, ok: boolean, data?: AnyData, error?: { code: string; message: string }): ApiResponse<AnyData> => ({
  http,
  ok,
  data,
  error,
});
const prepared = (amount: string) => ({
  policy: "P",
  merchant: "M",
  amount,
  requestId: "0".repeat(32),
  expiresAt: 1,
  requestHash: "1".repeat(64),
});

type Script = Partial<Record<keyof ApiClient, (...args: AnyData[]) => ApiResponse<AnyData>>>;

function fakeApi(script: Script, paused = false) {
  const calls: { fn: string; body?: AnyData }[] = [];
  const policyRes = () =>
    r(200, true, { vaultBalance: "45000000", isPaused: paused, derived: { effectiveSpentToday: "0" }, maxPerTx: "10000000" });
  const handler = (fn: keyof ApiClient) => async (...args: AnyData[]) => {
    calls.push({ fn, body: args[0] });
    const s = script[fn];
    if (s) return s(...args);
    if (fn === "policy") return policyRes();
    throw new Error(`unexpected call ${fn}`);
  };
  const api = new Proxy({}, { get: (_t, fn) => handler(fn as keyof ApiClient) }) as ApiClient;
  return { api, calls };
}

const ctx = (api: ApiClient, over: Partial<ScenarioContext> = {}): ScenarioContext => ({
  api,
  policy: "P",
  merchant: "M",
  attacker: "A",
  amount: "1000000",
  maxPerTx: "10000000",
  forceOnChain: false,
  sleep: async () => {},
  ...over,
});

const readyThenConfirmed: Script = {
  prepare: (b) => r(200, true, { status: "READY_TO_SIGN", preparedPayment: prepared(b.amount) }),
  submit: () => r(200, true, { status: "CONFIRMED", signature: SIG, explorerUrl: "x" }),
};
const rejectedInSimulation = (reason: string): Script => ({
  prepare: (b) =>
    r(422, false, { status: "REJECTED", evidence: "SIMULATION", reason, preparedPayment: prepared(b.amount) }, { code: reason, message: "m" }),
  submit: () => r(422, false, { status: "REJECTED", evidence: "ONCHAIN", reason, signature: SIG }, { code: reason, message: "m" }),
});

describe("security demo scenarios", () => {
  it("normal payment → CONFIRMED, matches expectation", async () => {
    const { api } = fakeApi(readyThenConfirmed);
    const o = await SCENARIOS.NORMAL_PAYMENT.run(ctx(api));
    expect(o.actual).toMatchObject({ status: "CONFIRMED", signature: SIG });
    expect(o.matchesExpectation).toBe(true);
    expect(o.before?.vaultBalance).toBe("45000000");
  });

  it("SUBMITTED is polled until final (never reported as confirmed early)", async () => {
    const { api } = fakeApi({
      prepare: readyThenConfirmed.prepare,
      submit: () => r(202, true, { status: "SUBMITTED", signature: SIG }),
      paymentStatus: () => r(200, true, { status: "CONFIRMED" }),
    });
    const o = await SCENARIOS.NORMAL_PAYMENT.run(ctx(api));
    expect(o.actual.status).toBe("CONFIRMED");
    expect(o.steps).toContain("status poll → CONFIRMED");
  });

  it("unauthorized merchant → REJECTED with SIMULATION evidence and nothing submitted", async () => {
    const { api, calls } = fakeApi(rejectedInSimulation("MERCHANT_NOT_ALLOWLISTED"));
    const o = await SCENARIOS.UNAUTHORIZED_MERCHANT.run(ctx(api));
    expect(o.actual).toMatchObject({ status: "REJECTED", evidence: "SIMULATION", reason: "MERCHANT_NOT_ALLOWLISTED", signature: null });
    expect(o.matchesExpectation).toBe(true);
    expect(calls.find((c) => c.fn === "prepare")?.body?.merchant).toBe("A"); // the attacker
    expect(calls.some((c) => c.fn === "submit")).toBe(false);
  });

  it("forced on-chain → ONCHAIN evidence with a signature, via demoForceSubmit", async () => {
    const { api, calls } = fakeApi(rejectedInSimulation("MERCHANT_NOT_ALLOWLISTED"));
    const o = await SCENARIOS.UNAUTHORIZED_MERCHANT.run(ctx(api, { forceOnChain: true }));
    expect(o.actual).toMatchObject({ status: "REJECTED", evidence: "ONCHAIN", signature: SIG });
    expect(calls.find((c) => c.fn === "submit")?.body?.demoForceSubmit).toBe(true);
  });

  it("excessive spending pays max_per_tx + 1 and expects EXCEEDS_MAX_PER_TX", async () => {
    const { api, calls } = fakeApi(rejectedInSimulation("EXCEEDS_MAX_PER_TX"));
    const o = await SCENARIOS.EXCESSIVE_SPENDING.run(ctx(api));
    expect(calls.find((c) => c.fn === "prepare")?.body?.amount).toBe("10000001");
    expect(o.matchesExpectation).toBe(true);
  });

  it("a wrong rejection reason is reported as unexpected", async () => {
    const { api } = fakeApi(rejectedInSimulation("EXCEEDS_DAILY_LIMIT"));
    const o = await SCENARIOS.EXCESSIVE_SPENDING.run(ctx(api));
    expect(o.matchesExpectation).toBe(false);
  });

  it("duplicate: pays once, then the identical resubmission is REJECTED (PRECHECK, or ONCHAIN when forced)", async () => {
    const dupe = { status: "REJECTED", evidence: "PRECHECK", reason: "DUPLICATE_REQUEST" };
    let submits = 0;
    const { api, calls } = fakeApi({
      prepare: readyThenConfirmed.prepare,
      submit: () => (++submits === 1 ? r(200, true, { status: "CONFIRMED", signature: SIG }) : r(409, false, dupe, { code: "DUPLICATE_REQUEST", message: "m" })),
    });
    const o = await SCENARIOS.DUPLICATE_PAYMENT.run(ctx(api));
    expect(o.actual).toMatchObject(dupe);
    expect(o.matchesExpectation).toBe(true);
    const submitBodies = calls.filter((c) => c.fn === "submit").map((c) => c.body);
    expect(submitBodies[1]?.requestHash).toBe(submitBodies[0]?.requestHash); // same request
    expect(submitBodies[1]?.demoForceSubmit).toBeUndefined();
  });

  it("duplicate: if the first payment fails, the scenario says so instead of claiming a duplicate", async () => {
    const { api } = fakeApi(rejectedInSimulation("EXCEEDS_DAILY_LIMIT"));
    const o = await SCENARIOS.DUPLICATE_PAYMENT.run(ctx(api));
    expect(o.matchesExpectation).toBe(false);
    expect(o.steps.join(" ")).toMatch(/cannot test the duplicate/);
  });

  it("emergency pause: not paused → owner action required (no payment attempted)", async () => {
    const { api, calls } = fakeApi({}, false);
    const o = await SCENARIOS.EMERGENCY_PAUSE.run(ctx(api));
    expect(o.actual.status).toBe("NEEDS_OWNER_ACTION");
    expect(calls.some((c) => c.fn === "prepare")).toBe(false);
  });

  it("emergency pause: paused → payment REJECTED with POLICY_PAUSED", async () => {
    const { api } = fakeApi(rejectedInSimulation("POLICY_PAUSED"), true);
    const o = await SCENARIOS.EMERGENCY_PAUSE.run(ctx(api));
    expect(o.actual).toMatchObject({ status: "REJECTED", reason: "POLICY_PAUSED" });
    expect(o.matchesExpectation).toBe(true);
  });

  it("prompt injection: reports the demo route's on-chain result, agent labels and before/after", async () => {
    const { api, calls } = fakeApi({
      promptInjection: () =>
        r(200, true, {
          agent: { agentOutputSource: "SCRIPTED" },
          intent: { merchant: "A" },
          result: { status: "REJECTED", evidence: "ONCHAIN", reason: "MERCHANT_NOT_ALLOWLISTED", signature: SIG, explorerUrl: "x", message: "m" },
          before: { vaultBalance: "45", spentToday: "5" },
          after: { vaultBalance: "45", spentToday: "5" },
          unchanged: true,
          receiptExists: false,
        }),
    });
    const o = await SCENARIOS.PROMPT_INJECTION.run(ctx(api, { forceOnChain: true, agentMode: "SCRIPTED" }));
    expect(o.actual).toMatchObject({ status: "REJECTED", evidence: "ONCHAIN", signature: SIG });
    expect(o.matchesExpectation).toBe(true);
    expect(o.extra).toMatchObject({ unchanged: true, receiptExists: false });
    expect(calls[0].body).toMatchObject({ agentMode: "SCRIPTED", submitOnChain: true, source: "FIXTURE" });
  });

  it("API errors (e.g. policy not served) are shown as request errors, not payment results", async () => {
    const { api } = fakeApi({
      prepare: () => r(403, false, undefined, { code: "POLICY_NOT_SERVED", message: "not served" }),
    });
    const o = await SCENARIOS.NORMAL_PAYMENT.run(ctx(api));
    expect(o.actual).toMatchObject({ status: "ERROR", reason: "POLICY_NOT_SERVED", signature: null });
    expect(o.matchesExpectation).toBe(false);
  });
});
