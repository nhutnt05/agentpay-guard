import "server-only";
import { type Connection, PublicKey } from "@solana/web3.js";
import { merchantAllowlistPda } from "@/lib/anchor/pda";
import type { AgentPaymentFirewallProgram } from "@/lib/anchor/program";
import { formatBaseUnits } from "@/lib/solana/amounts";
import { type DecodedPolicy, loadPolicy } from "@/lib/policy/read";
import { checkPolicyServed } from "@/lib/server/access";
import { prepareContent } from "./content";
import { ScrapeError, type Scraper } from "./firecrawl";
import { toPaymentIntent } from "./intent";
import {
  type LlmClient,
  LlmOutputInvalidError,
  LlmRefusedError,
  LlmUnavailableError,
  proposePayment,
} from "./llm";
import { PROMPT_VERSION } from "./prompts";
import type { AnalyzeRequest, PaymentRequestBody } from "./schemas";

// Agent services (docs/06 §3.2–3.3). NO chain writes here. The agent only PROPOSES; the
// payment routes + the on-chain program decide. Allowlist/limit findings are informational
// warnings — they are deliberately NOT enforced here, so the on-chain rejection can be shown.

export class AgentServiceError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AgentServiceError";
  }
}

export interface AgentDeps {
  rpc: Pick<Connection, "getAccountInfoAndContext" | "getAccountInfo">;
  program: AgentPaymentFirewallProgram;
  agent: PublicKey | null;
  allowedOwners: ReadonlySet<string>;
  demoMode: boolean;
  getDecimals: (mint: PublicKey) => Promise<number>;
  scrape: Scraper;
  /** Injected in tests; defaults to the Anthropic client. */
  llm?: LlmClient;
}

async function requirePolicy(deps: AgentDeps, address: PublicKey): Promise<DecodedPolicy> {
  const lookup = await loadPolicy(deps.rpc, deps.program, address);
  if (lookup.kind === "missing") throw new AgentServiceError(404, "NOT_FOUND", "no account at this address");
  if (lookup.kind === "not_a_policy") {
    throw new AgentServiceError(404, "NOT_A_POLICY", "account is not an AgentPay Guard policy");
  }
  return lookup.policy;
}

/** POST /agent/analyze: content → LLM proposal → strictly validated intent (status PENDING). */
export async function analyzeIntent(deps: AgentDeps, req: AnalyzeRequest, policyAddress: PublicKey) {
  if (req.mode === "VULNERABLE_DEMO" && !deps.demoMode) {
    throw new AgentServiceError(403, "DEMO_DISABLED", "VULNERABLE_DEMO mode requires DEMO_MODE=true");
  }
  const policy = await requirePolicy(deps, policyAddress);
  const decision = checkPolicyServed(policy, deps.agent, deps.allowedOwners);
  if (!decision.allowed) {
    throw new AgentServiceError(403, "POLICY_NOT_SERVED", "this server's agent does not act for this policy", {
      reason: decision.reason,
    });
  }

  let raw: string;
  let contentSource: "FIRECRAWL" | "TEXT";
  if (req.url) {
    try {
      raw = await deps.scrape(req.url);
    } catch (e) {
      throw new AgentServiceError(502, "FIRECRAWL_ERROR", e instanceof ScrapeError ? e.message : "scrape failed");
    }
    contentSource = "FIRECRAWL";
  } else {
    raw = req.text ?? "";
    contentSource = "TEXT";
  }
  const content = prepareContent(raw);

  let llm;
  try {
    llm = await proposePayment({ userInstruction: req.userInstruction, content: content.text, mode: req.mode }, deps.llm);
  } catch (e) {
    if (e instanceof LlmRefusedError) {
      throw new AgentServiceError(422, "LLM_REFUSED", e.message, { category: e.category });
    }
    if (e instanceof LlmOutputInvalidError) {
      throw new AgentServiceError(422, "LLM_OUTPUT_INVALID", e.message, e.issues);
    }
    if (e instanceof LlmUnavailableError) throw new AgentServiceError(502, "LLM_ERROR", e.message);
    throw new AgentServiceError(502, "LLM_ERROR", "LLM request failed");
  }

  const decimals = await deps.getDecimals(policy.mint);
  const conversion = toPaymentIntent(llm.proposal, { mint: policy.mint, decimals }, req.url);

  const warnings = ["The agent's proposal is untrusted; the on-chain policy is the final authority."];
  if (conversion.intent) {
    const merchant = new PublicKey(conversion.intent.merchant);
    const entry = await deps.rpc.getAccountInfo(merchantAllowlistPda(policyAddress, merchant)[0], "confirmed");
    if (!entry) {
      warnings.push("Merchant is not on this policy's allowlist (informational; enforcement is on-chain).");
    }
    if (BigInt(conversion.intent.amount) > BigInt(policy.maxPerTx.toString())) {
      warnings.push("Amount exceeds the policy's per-transaction limit (informational; enforcement is on-chain).");
    }
  }

  return {
    status: "PENDING" as const,
    mode: req.mode,
    intent: conversion.intent,
    intentValid: conversion.intentValid,
    issues: conversion.issues,
    proposal: llm.proposal, // raw model output, shown as untrusted text
    llm: {
      provider: "anthropic",
      model: llm.model,
      requestedModel: llm.requestedModel,
      stopReason: llm.stopReason,
      fallbackUsed: llm.fallbackUsed,
    },
    promptVersion: PROMPT_VERSION,
    contentSource,
    contentSha256: content.sha256,
    contentTruncated: content.truncated,
    contentBytes: content.originalBytes,
    contentPreview: content.text.slice(0, 2_000),
    warnings,
  };
}

/** POST /agent/payment-request: normalize an intent; mint/decimals always from chain. */
export async function normalizePaymentRequest(deps: AgentDeps, body: PaymentRequestBody, policyAddress: PublicKey) {
  const policy = await requirePolicy(deps, policyAddress);
  const decimals = await deps.getDecimals(policy.mint);
  const decision = checkPolicyServed(policy, deps.agent, deps.allowedOwners);
  return {
    paymentRequest: {
      policy: policyAddress.toBase58(),
      merchant: body.merchant,
      amount: body.amount,
      mint: policy.mint.toBase58(),
      decimals,
      uiAmount: formatBaseUnits(BigInt(body.amount), decimals),
      reason: body.reason,
      status: "PENDING" as const,
    },
    servedByThisAgent: decision.allowed,
    accessReason: decision.allowed ? null : decision.reason,
  };
}
