import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { buildUserMessage, systemPromptFor } from "./prompts";
import { type AnalyzeMode, type LlmPaymentProposal, LlmPaymentProposalSchema } from "./schemas";

// LLM call (docs/08 §2.2). Provider abstraction: routes only use `proposePayment`.
// - Model: claude-opus-5-5 by default (LLM_MODEL overrides).
// - Structured output via beta `messages.parse` + `betaZodOutputFormat`.
// - Server-side refusal fallback ON (`fallbacks: "default"`): if the model declines, the API
//   re-runs the request on a fallback model in the same call; we report which model answered.
// - stop_reason is checked before reading content.

export const DEFAULT_LLM_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

export class LlmRefusedError extends Error {
  constructor(readonly category: string | null) {
    super("the model declined to answer");
    this.name = "LlmRefusedError";
  }
}
export class LlmOutputInvalidError extends Error {
  constructor(message: string, readonly issues?: unknown) {
    super(message);
    this.name = "LlmOutputInvalidError";
  }
}
export class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

export interface LlmResult {
  proposal: LlmPaymentProposal;
  model: string;
  requestedModel: string;
  stopReason: string;
  fallbackUsed: boolean;
}

/** The part of the Anthropic client we use (injectable for tests). */
export interface LlmClient {
  beta: { messages: { parse: Anthropic["beta"]["messages"]["parse"] } };
}

let client: Anthropic | undefined;
function defaultClient(): LlmClient {
  if (!process.env.ANTHROPIC_API_KEY) throw new LlmUnavailableError("ANTHROPIC_API_KEY is not configured");
  client ??= new Anthropic();
  return client;
}

export async function proposePayment(
  input: { userInstruction: string; content: string; mode: AnalyzeMode },
  llm: LlmClient = defaultClient(),
): Promise<LlmResult> {
  const requestedModel = process.env.LLM_MODEL || DEFAULT_LLM_MODEL;

  let response: Awaited<ReturnType<LlmClient["beta"]["messages"]["parse"]>>;
  try {
    response = await llm.beta.messages.parse({
      model: requestedModel,
      max_tokens: 16_000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { effort: "low", format: betaZodOutputFormat(LlmPaymentProposalSchema) },
      system: systemPromptFor(input.mode),
      messages: [{ role: "user", content: buildUserMessage(input.userInstruction, input.content) }],
    });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) throw new LlmUnavailableError("LLM rate limited — retry later");
    if (e instanceof Anthropic.AuthenticationError) throw new LlmUnavailableError("LLM authentication failed");
    if (e instanceof Anthropic.APIError) throw new LlmUnavailableError(`LLM API error ${e.status ?? ""}`.trim());
    throw new LlmUnavailableError("LLM request failed");
  }

  // Check the stop reason BEFORE reading content.
  if (response.stop_reason === "refusal") {
    throw new LlmRefusedError(response.stop_details?.category ?? null);
  }
  if (response.stop_reason === "max_tokens") {
    throw new LlmOutputInvalidError("LLM output was cut off (max_tokens)");
  }

  const parsed = LlmPaymentProposalSchema.safeParse(response.parsed_output);
  if (!parsed.success) {
    throw new LlmOutputInvalidError("LLM output did not match the proposal schema", parsed.error.issues);
  }

  const fallbackUsed = (response.usage?.iterations ?? []).some(
    (entry: { type?: string }) => entry.type === "fallback_message",
  );
  return {
    proposal: parsed.data,
    model: response.model,
    requestedModel,
    stopReason: response.stop_reason ?? "unknown",
    fallbackUsed,
  };
}
