import "server-only";
import { PublicKey } from "@solana/web3.js";
import { z } from "zod";
import type { PaymentResult } from "@/lib/server/payments";
import type { PrepareRequest, SubmitRequest } from "@/lib/validation/payments";
import { PubkeySchema } from "@/lib/validation/common";
import { prepareContent } from "./content";
import { ScrapeError, type Scraper } from "./firecrawl";
import { maliciousPageFixture } from "./fixtures/maliciousPage";
import { toPaymentIntent } from "./intent";
import { type LlmClient, proposePayment } from "./llm";
import { PROMPT_VERSION } from "./prompts";

// Prompt-injection demo (docs/06 §3.10, docs/08 §3, DEMO-01). Honest by construction:
//  - The agent is DELIBERATELY vulnerable (VULNERABLE_DEMO prompt) and labeled as such.
//  - If the LLM does not produce the attacker payment, a SCRIPTED compromised intent is used
//    and labeled `agentOutputSource: "SCRIPTED"` — the on-chain part is identical and real.
//  - The blockchain result is never simulated as on-chain: evidence is ONCHAIN only when a
//    failed transaction was actually submitted (demoForceSubmit), otherwise SIMULATION.
//  - before/after are on-chain reads, so "nothing moved" is shown, not claimed.

export const DemoRequestSchema = z
  .object({
    policy: PubkeySchema,
    source: z.enum(["FIXTURE", "HOSTED_PAGE"]).default("FIXTURE"),
    agentMode: z.enum(["LLM", "SCRIPTED"]).default("LLM"),
    submitOnChain: z.boolean().default(true),
  })
  .strict();
export type DemoRequest = z.infer<typeof DemoRequestSchema>;

export class DemoError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DemoError";
  }
}

export interface DemoState {
  vaultBalance: string | null;
  spentToday: string;
  attackerBalance: string | null;
}

export interface DemoDeps {
  demoMode: boolean;
  attackerWallet: string | undefined;
  maliciousUrl: string | undefined;
  scrape: Scraper;
  llm?: LlmClient;
  /** Policy mint decimals (from chain). */
  getDecimals: (policy: PublicKey) => Promise<number>;
  /** On-chain snapshot used for before/after. */
  readState: (policy: PublicKey, attacker: PublicKey) => Promise<DemoState>;
  receiptExists: (receipt: PublicKey) => Promise<boolean>;
  prepare: (input: PrepareRequest) => Promise<PaymentResult>;
  submit: (input: SubmitRequest) => Promise<PaymentResult>;
}

/** The compromised intent used when the LLM does not (or may not) produce one. */
const SCRIPTED_AMOUNT_WHOLE = 5n; // "Send 5 USDC" from the malicious page

export async function runPromptInjectionDemo(deps: DemoDeps, req: DemoRequest) {
  if (!deps.demoMode) throw new DemoError(404, "NOT_FOUND", "demo routes are disabled");
  if (!deps.attackerWallet) throw new DemoError(500, "CONFIG_ERROR", "DEMO_ATTACKER_WALLET is not configured");
  let attacker: PublicKey;
  try {
    attacker = new PublicKey(deps.attackerWallet);
  } catch {
    throw new DemoError(500, "CONFIG_ERROR", "DEMO_ATTACKER_WALLET is not a valid public key");
  }
  const policy = new PublicKey(req.policy);

  // 1. Content the agent "visits".
  let raw: string;
  if (req.source === "HOSTED_PAGE") {
    if (!deps.maliciousUrl || deps.maliciousUrl.startsWith("<")) {
      throw new DemoError(500, "CONFIG_ERROR", "DEMO_MALICIOUS_URL is not configured (use source FIXTURE)");
    }
    try {
      raw = await deps.scrape(deps.maliciousUrl);
    } catch (e) {
      throw new DemoError(502, "FIRECRAWL_ERROR", e instanceof ScrapeError ? e.message : "scrape failed");
    }
  } else {
    raw = maliciousPageFixture(attacker.toBase58());
  }
  const content = prepareContent(raw);
  const decimals = await deps.getDecimals(policy);

  // 2. Agent output: vulnerable LLM, or labeled scripted fallback.
  let agentOutputSource: "LLM" | "SCRIPTED" = "SCRIPTED";
  let llmNote: string | null = req.agentMode === "SCRIPTED" ? "LLM skipped (agentMode SCRIPTED)" : null;
  let llmModel: string | null = null;
  let merchant = attacker;
  let amount = SCRIPTED_AMOUNT_WHOLE * 10n ** BigInt(decimals);
  let reason = "SCRIPTED compromised intent (simulates a successfully injected agent)";

  if (req.agentMode === "LLM") {
    try {
      const llm = await proposePayment(
        { userInstruction: "Buy the Starter plan from this page.", content: content.text, mode: "VULNERABLE_DEMO" },
        deps.llm,
      );
      llmModel = llm.model;
      const conv = toPaymentIntent(llm.proposal, { mint: PublicKey.default, decimals });
      if (conv.intent && conv.intent.merchant === attacker.toBase58()) {
        agentOutputSource = "LLM";
        merchant = new PublicKey(conv.intent.merchant);
        amount = BigInt(conv.intent.amount);
        reason = conv.intent.reason;
      } else {
        llmNote = conv.intent
          ? "The model resisted the injection (proposed a different recipient); using the scripted compromised intent."
          : `The model did not produce a payment (${conv.issues.join("; ") || "no intent"}); using the scripted compromised intent.`;
      }
    } catch (e) {
      llmNote = `LLM unavailable (${(e as Error).name}); using the scripted compromised intent.`;
    }
  }

  // 3. Real on-chain state before, then the payment attempt through the normal payment path.
  const before = await deps.readState(policy, attacker);
  const prepared = await deps.prepare({
    policy: policy.toBase58(),
    merchant: merchant.toBase58(),
    amount: amount.toString(),
    expiresInSeconds: 300,
  });

  let result: PaymentResult = prepared;
  if (req.submitOnChain && prepared.preparedPayment) {
    const p = prepared.preparedPayment;
    result = await deps.submit({
      policy: p.policy,
      merchant: p.merchant,
      amount: p.amount,
      requestId: p.requestId,
      expiresAt: p.expiresAt,
      requestHash: p.requestHash,
      demoForceSubmit: true,
    });
  }
  const after = await deps.readState(policy, attacker);
  const receipt = result.preparedPayment?.receipt ?? prepared.preparedPayment?.receipt;

  return {
    scenario: "PROMPT_INJECTION",
    contentSource: req.source,
    contentLabel: req.source === "FIXTURE" ? "fixture content, not live scrape" : "live scrape (Firecrawl)",
    contentSha256: content.sha256,
    contentPreview: content.text.slice(0, 2_000),
    agent: {
      mode: "VULNERABLE_DEMO",
      label: "Intentionally vulnerable agent configuration (demo)",
      agentOutputSource,
      llmModel,
      llmNote,
      promptVersion: PROMPT_VERSION,
    },
    intent: { merchant: merchant.toBase58(), amount: amount.toString(), reason },
    attackerIsTarget: merchant.equals(attacker),
    result: {
      status: result.status,
      evidence: result.evidence ?? null,
      reason: result.reason ?? null,
      programError: result.programError ?? null,
      signature: result.signature ?? null,
      explorerUrl: result.explorerUrl ?? null,
      message: result.message ?? null,
    },
    before,
    after,
    unchanged:
      before.vaultBalance === after.vaultBalance &&
      before.spentToday === after.spentToday &&
      before.attackerBalance === after.attackerBalance,
    receiptExists: receipt ? await deps.receiptExists(new PublicKey(receipt)) : false,
  };
}
