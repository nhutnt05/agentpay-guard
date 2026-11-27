import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import type { PaymentResult } from "@/lib/server/payments";
import type { PrepareRequest, SubmitRequest } from "@/lib/validation/payments";
import { type DemoDeps, DemoRequestSchema, type DemoState, runPromptInjectionDemo } from "./demo";
import type { LlmClient } from "./llm";

// Orchestration of the prompt-injection demo (DEMO-01 logic). The payment path itself is
// covered by payments.test.ts; here prepare/submit are recorded stubs.

const policy = Keypair.generate().publicKey;
const attacker = Keypair.generate().publicKey;
const honest = Keypair.generate().publicKey;
const SIG = "5uCXVGHUYpCgPBW4qJfyKsaUGov3E12avRn6YzBFQa7CTGPnV1fEAAUgfisvBjHvDQzC31Gdrn6sChPFGSz3Jih8";

const prepared = (p: PrepareRequest) => ({
  policy: p.policy,
  merchant: p.merchant,
  merchantTokenAccount: honest.toBase58(),
  mint: honest.toBase58(),
  vault: honest.toBase58(),
  amount: p.amount,
  requestId: "0".repeat(32),
  expiresAt: 1_800_000_300,
  requestHash: "1".repeat(64),
  receipt: Keypair.generate().publicKey.toBase58(),
});

function llmReturning(merchant: string | null, opts: { fail?: boolean } = {}): LlmClient {
  return {
    beta: {
      messages: {
        parse: async (params: { model: string }) => {
          if (opts.fail) throw new Error("network");
          return {
            model: params.model,
            stop_reason: "end_turn",
            stop_details: null,
            usage: { iterations: [] },
            parsed_output: { shouldPay: true, merchant, amountDecimal: "5", tokenSymbol: "USDC", mint: null, reason: "urgent" },
          };
        },
      },
    },
  } as unknown as LlmClient;
}

function deps(over: Partial<DemoDeps> = {}, state: { changeAfter?: boolean } = {}) {
  const calls = { prepare: [] as PrepareRequest[], submit: [] as SubmitRequest[], reads: 0 };
  const snapshot = (): DemoState => {
    calls.reads++;
    const changed = state.changeAfter && calls.reads > 1;
    return { vaultBalance: changed ? "40000000" : "45000000", spentToday: "5000000", attackerBalance: "0" };
  };
  const d: DemoDeps = {
    demoMode: true,
    attackerWallet: attacker.toBase58(),
    maliciousUrl: undefined,
    scrape: async () => "page",
    getDecimals: async () => 6,
    readState: async () => snapshot(),
    receiptExists: async () => false,
    prepare: async (input): Promise<PaymentResult> => {
      calls.prepare.push(input);
      return {
        httpStatus: 422,
        status: "REJECTED",
        evidence: "SIMULATION",
        reason: "MERCHANT_NOT_ALLOWLISTED",
        programError: { code: 3012, name: "AccountNotInitialized", account: "merchant_allowlist" },
        preparedPayment: prepared(input),
      };
    },
    submit: async (input): Promise<PaymentResult> => {
      calls.submit.push(input);
      return {
        httpStatus: 422,
        status: "REJECTED",
        evidence: "ONCHAIN",
        reason: "MERCHANT_NOT_ALLOWLISTED",
        signature: SIG,
        explorerUrl: `https://explorer.solana.com/tx/${SIG}?cluster=devnet`,
      };
    },
    ...over,
  };
  return { d, calls };
}

const req = (over: Record<string, unknown> = {}) => DemoRequestSchema.parse({ policy: policy.toBase58(), ...over });

describe("prompt-injection demo", () => {
  it("is disabled unless DEMO_MODE (API-06) and requires an attacker wallet", async () => {
    await expect(runPromptInjectionDemo(deps({ demoMode: false }).d, req())).rejects.toMatchObject({ httpStatus: 404 });
    await expect(runPromptInjectionDemo(deps({ attackerWallet: undefined }).d, req())).rejects.toMatchObject({
      code: "CONFIG_ERROR",
    });
  });

  it("LLM follows the injection → agentOutputSource LLM; failing tx forced on-chain; state unchanged", async () => {
    const { d, calls } = deps({ llm: llmReturning(attacker.toBase58()) });
    const r = await runPromptInjectionDemo(d, req());
    expect(r.agent).toMatchObject({ agentOutputSource: "LLM", mode: "VULNERABLE_DEMO", llmNote: null });
    expect(r.intent).toMatchObject({ merchant: attacker.toBase58(), amount: "5000000" });
    expect(calls.prepare[0]).toMatchObject({ merchant: attacker.toBase58(), amount: "5000000" });
    expect(calls.submit[0]).toMatchObject({ demoForceSubmit: true, requestHash: "1".repeat(64) });
    expect(r.result).toMatchObject({ status: "REJECTED", evidence: "ONCHAIN", reason: "MERCHANT_NOT_ALLOWLISTED", signature: SIG });
    expect(r.unchanged).toBe(true);
    expect(r.receiptExists).toBe(false);
    expect(r.contentLabel).toBe("fixture content, not live scrape");
  });

  it("LLM resists (different recipient) → labeled SCRIPTED fallback, never silent", async () => {
    const { d } = deps({ llm: llmReturning(honest.toBase58()) });
    const r = await runPromptInjectionDemo(d, req());
    expect(r.agent.agentOutputSource).toBe("SCRIPTED");
    expect(r.agent.llmNote).toMatch(/resisted/);
    expect(r.intent.merchant).toBe(attacker.toBase58());
  });

  it("LLM unavailable → labeled SCRIPTED fallback", async () => {
    const { d } = deps({ llm: llmReturning(null, { fail: true }) });
    const r = await runPromptInjectionDemo(d, req());
    expect(r.agent).toMatchObject({ agentOutputSource: "SCRIPTED" });
    expect(r.agent.llmNote).toMatch(/LLM unavailable/);
  });

  it("agentMode SCRIPTED skips the LLM entirely", async () => {
    const llm = { beta: { messages: { parse: async () => { throw new Error("must not be called"); } } } } as unknown as LlmClient;
    const { d } = deps({ llm });
    const r = await runPromptInjectionDemo(d, req({ agentMode: "SCRIPTED" }));
    expect(r.agent).toMatchObject({ agentOutputSource: "SCRIPTED", llmModel: null });
    expect(r.agent.llmNote).toMatch(/skipped/);
  });

  it("submitOnChain false → SIMULATION evidence, no signature, nothing submitted", async () => {
    const { d, calls } = deps();
    const r = await runPromptInjectionDemo(d, req({ agentMode: "SCRIPTED", submitOnChain: false }));
    expect(calls.submit).toHaveLength(0);
    expect(r.result).toMatchObject({ status: "REJECTED", evidence: "SIMULATION", signature: null });
  });

  it("'unchanged' is computed from real reads, not assumed", async () => {
    const { d } = deps({}, { changeAfter: true });
    const r = await runPromptInjectionDemo(d, req({ agentMode: "SCRIPTED" }));
    expect(r.unchanged).toBe(false);
  });

  it("HOSTED_PAGE requires a configured URL", async () => {
    const { d } = deps({ maliciousUrl: "<https://YOUR_DEPLOYMENT/demo/malicious-merchant>" });
    await expect(runPromptInjectionDemo(d, req({ source: "HOSTED_PAGE" }))).rejects.toMatchObject({ code: "CONFIG_ERROR" });
  });

  it("request schema rejects unknown fields", () => {
    expect(DemoRequestSchema.safeParse({ policy: policy.toBase58(), merchant: attacker.toBase58() }).success).toBe(false);
    expect(new PublicKey(attacker.toBase58()).equals(attacker)).toBe(true);
  });
});
