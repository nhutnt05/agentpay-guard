import type { AnyData, ApiClient, ApiResponse } from "@/lib/client/api";
import type { OutcomeStatus } from "./labels";

// The six Security Demo scenarios (docs/07 §4), independent of React so they are testable
// and runnable against a live server. Each declares what the firewall SHOULD do and reports
// what actually happened, with on-chain before/after reads. Nothing here fakes a result:
// every status comes from the API, which reads the chain.

export type ScenarioId =
  | "NORMAL_PAYMENT"
  | "PROMPT_INJECTION"
  | "UNAUTHORIZED_MERCHANT"
  | "EXCESSIVE_SPENDING"
  | "DUPLICATE_PAYMENT"
  | "EMERGENCY_PAUSE";

export interface Attempt {
  status: OutcomeStatus;
  evidence: string | null;
  reason: string | null;
  signature: string | null;
  explorerUrl: string | null;
  message: string | null;
  http: number;
}

export interface PolicySnapshot {
  vaultBalance: string | null;
  spentTodayEffective: string | null;
  isPaused: boolean | null;
}

export interface ScenarioOutcome {
  scenario: ScenarioId;
  expected: { status: OutcomeStatus; reason?: string };
  actual: Attempt;
  matchesExpectation: boolean;
  before: PolicySnapshot | null;
  after: PolicySnapshot | null;
  steps: string[];
  extra?: AnyData;
}

export interface ScenarioContext {
  api: ApiClient;
  policy: string;
  /** An allowlisted merchant (normal / duplicate / pause scenarios). */
  merchant: string;
  /** A non-allowlisted wallet (unauthorized merchant scenario). */
  attacker: string;
  /** Normal payment amount in base units. */
  amount: string;
  /** policy.max_per_tx in base units (excessive spending scenario). */
  maxPerTx: string;
  /** Submit failing transactions on-chain (demoForceSubmit; requires DEMO_MODE). */
  forceOnChain: boolean;
  agentMode?: "LLM" | "SCRIPTED";
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function toAttempt(res: ApiResponse<AnyData>): Attempt {
  const d = res.data ?? {};
  const status = (d.status as OutcomeStatus | undefined) ?? (res.ok ? "PENDING" : "ERROR");
  return {
    status,
    evidence: (d.evidence as string) ?? null,
    reason: (d.reason as string) ?? (status === "ERROR" ? (res.error?.code ?? null) : null),
    signature: (d.signature as string) ?? null,
    explorerUrl: (d.explorerUrl as string) ?? null,
    message: res.error?.message ?? (d.message as string) ?? null,
    http: res.http,
  };
}

async function snapshot(ctx: ScenarioContext): Promise<PolicySnapshot | null> {
  const r = await ctx.api.policy(ctx.policy);
  if (!r.ok || !r.data) return null;
  return {
    vaultBalance: r.data.vaultBalance ?? null,
    spentTodayEffective: r.data.derived?.effectiveSpentToday ?? r.data.spentTodayStored ?? null,
    isPaused: r.data.isPaused ?? null,
  };
}

/** Polls a SUBMITTED payment until it is final (bounded). */
async function settle(ctx: ScenarioContext, res: ApiResponse<AnyData>, steps: string[]): Promise<Attempt> {
  let attempt = toAttempt(res);
  const sleep = ctx.sleep ?? defaultSleep;
  for (let i = 0; i < 30 && attempt.status === "SUBMITTED" && attempt.signature; i++) {
    await sleep(2_000);
    const s = await ctx.api.paymentStatus(attempt.signature);
    if (s.ok && s.data && s.data.status !== "SUBMITTED") {
      steps.push(`status poll → ${s.data.status}`);
      attempt = {
        ...attempt,
        status: s.data.status,
        reason: s.data.error?.reason ?? attempt.reason,
        evidence: s.data.status === "CONFIRMED" ? null : "ONCHAIN",
      };
    }
  }
  return attempt;
}

const fieldsOf = (p: AnyData) => ({
  policy: p.policy,
  merchant: p.merchant,
  amount: p.amount,
  requestId: p.requestId,
  expiresAt: p.expiresAt,
  requestHash: p.requestHash,
});

/** prepare → (submit | forced submit | stop). Returns the final attempt and prepared fields. */
async function pay(
  ctx: ScenarioContext,
  merchant: string,
  amount: string,
  steps: string[],
): Promise<{ attempt: Attempt; prepared: AnyData | null }> {
  const prep = await ctx.api.prepare({ policy: ctx.policy, merchant, amount });
  const p = prep.data?.preparedPayment as AnyData | undefined;
  steps.push(`prepare → ${prep.data?.status ?? prep.error?.code ?? prep.http}`);
  if (!p) return { attempt: toAttempt(prep), prepared: null };

  if (prep.data?.status === "READY_TO_SIGN") {
    const sub = await ctx.api.submit(fieldsOf(p));
    steps.push(`submit → ${sub.data?.status ?? sub.error?.code ?? sub.http}`);
    return { attempt: await settle(ctx, sub, steps), prepared: p };
  }
  if (prep.data?.status === "REJECTED" && ctx.forceOnChain) {
    const sub = await ctx.api.submit({ ...fieldsOf(p), demoForceSubmit: true });
    steps.push(`forced on-chain submit → ${sub.data?.status ?? sub.error?.code ?? sub.http}`);
    return { attempt: await settle(ctx, sub, steps), prepared: p };
  }
  return { attempt: toAttempt(prep), prepared: p };
}

function outcome(
  scenario: ScenarioId,
  expected: ScenarioOutcome["expected"],
  actual: Attempt,
  before: PolicySnapshot | null,
  after: PolicySnapshot | null,
  steps: string[],
  extra?: AnyData,
): ScenarioOutcome {
  const matchesExpectation =
    actual.status === expected.status && (expected.reason === undefined || actual.reason === expected.reason);
  return { scenario, expected, actual, matchesExpectation, before, after, steps, extra };
}

async function single(
  ctx: ScenarioContext,
  scenario: ScenarioId,
  expected: ScenarioOutcome["expected"],
  merchant: string,
  amount: string,
): Promise<ScenarioOutcome> {
  const steps: string[] = [];
  const before = await snapshot(ctx);
  const { attempt } = await pay(ctx, merchant, amount, steps);
  return outcome(scenario, expected, attempt, before, await snapshot(ctx), steps);
}

export const SCENARIOS: Record<ScenarioId, { title: string; description: string; run: (ctx: ScenarioContext) => Promise<ScenarioOutcome> }> = {
  NORMAL_PAYMENT: {
    title: "Normal payment",
    description: "The agent pays an allowlisted merchant within limits.",
    run: (ctx) => single(ctx, "NORMAL_PAYMENT", { status: "CONFIRMED" }, ctx.merchant, ctx.amount),
  },
  PROMPT_INJECTION: {
    title: "Prompt injection attack",
    description: "A deliberately vulnerable agent reads a page that tells it to pay an attacker.",
    run: async (ctx) => {
      const steps: string[] = [];
      const res = await ctx.api.promptInjection({
        policy: ctx.policy,
        source: "FIXTURE",
        agentMode: ctx.agentMode ?? "LLM",
        submitOnChain: ctx.forceOnChain,
      });
      steps.push(`demo/prompt-injection → ${res.data?.result?.status ?? res.error?.code ?? res.http}`);
      const d = res.data;
      const actual: Attempt = d
        ? {
            status: d.result.status,
            evidence: d.result.evidence,
            reason: d.result.reason,
            signature: d.result.signature,
            explorerUrl: d.result.explorerUrl,
            message: d.result.message,
            http: res.http,
          }
        : toAttempt(res);
      const snap = (s: AnyData | undefined): PolicySnapshot | null =>
        s ? { vaultBalance: s.vaultBalance, spentTodayEffective: s.spentToday, isPaused: null } : null;
      return outcome(
        "PROMPT_INJECTION",
        { status: "REJECTED", reason: "MERCHANT_NOT_ALLOWLISTED" },
        actual,
        snap(d?.before),
        snap(d?.after),
        steps,
        d ? { agent: d.agent, intent: d.intent, unchanged: d.unchanged, receiptExists: d.receiptExists, contentLabel: d.contentLabel } : undefined,
      );
    },
  },
  UNAUTHORIZED_MERCHANT: {
    title: "Unauthorized merchant",
    description: "The agent tries to pay a wallet that is not on the allowlist.",
    run: (ctx) =>
      single(ctx, "UNAUTHORIZED_MERCHANT", { status: "REJECTED", reason: "MERCHANT_NOT_ALLOWLISTED" }, ctx.attacker, ctx.amount),
  },
  EXCESSIVE_SPENDING: {
    title: "Excessive spending",
    description: "The agent tries to pay one base unit more than the per-transaction limit.",
    run: (ctx) =>
      single(
        ctx,
        "EXCESSIVE_SPENDING",
        { status: "REJECTED", reason: "EXCEEDS_MAX_PER_TX" },
        ctx.merchant,
        (BigInt(ctx.maxPerTx) + 1n).toString(),
      ),
  },
  DUPLICATE_PAYMENT: {
    title: "Duplicate payment",
    description: "The same request is submitted twice; the receipt makes the second one fail.",
    run: async (ctx) => {
      const steps: string[] = [];
      const before = await snapshot(ctx);
      const first = await pay(ctx, ctx.merchant, ctx.amount, steps);
      if (first.attempt.status !== "CONFIRMED" || !first.prepared) {
        steps.push("first payment did not confirm — cannot test the duplicate");
        return outcome("DUPLICATE_PAYMENT", { status: "REJECTED", reason: "DUPLICATE_REQUEST" }, first.attempt, before, await snapshot(ctx), steps);
      }
      const again = await ctx.api.submit({ ...fieldsOf(first.prepared), ...(ctx.forceOnChain ? { demoForceSubmit: true } : {}) });
      steps.push(`resubmit same request → ${again.data?.status ?? again.error?.code ?? again.http}`);
      const attempt = await settle(ctx, again, steps);
      return outcome(
        "DUPLICATE_PAYMENT",
        { status: "REJECTED", reason: "DUPLICATE_REQUEST" },
        attempt,
        before,
        await snapshot(ctx),
        steps,
        { firstPayment: first.attempt },
      );
    },
  },
  EMERGENCY_PAUSE: {
    title: "Emergency pause",
    description: "After the owner pauses the policy, every agent payment is rejected.",
    run: async (ctx) => {
      const before = await snapshot(ctx);
      if (!before?.isPaused) {
        const actual: Attempt = {
          status: "NEEDS_OWNER_ACTION",
          evidence: null,
          reason: null,
          signature: null,
          explorerUrl: null,
          message: "The policy is not paused. The owner must pause it with their wallet, then run this scenario again.",
          http: 200,
        };
        return outcome("EMERGENCY_PAUSE", { status: "REJECTED", reason: "POLICY_PAUSED" }, actual, before, before, [
          "policy read → not paused",
        ]);
      }
      const steps = ["policy read → paused"];
      const { attempt } = await pay(ctx, ctx.merchant, ctx.amount, steps);
      return outcome("EMERGENCY_PAUSE", { status: "REJECTED", reason: "POLICY_PAUSED" }, attempt, before, await snapshot(ctx), steps);
    },
  },
};

export const SCENARIO_ORDER: ScenarioId[] = [
  "NORMAL_PAYMENT",
  "PROMPT_INJECTION",
  "UNAUTHORIZED_MERCHANT",
  "EXCESSIVE_SPENDING",
  "DUPLICATE_PAYMENT",
  "EMERGENCY_PAUSE",
];
