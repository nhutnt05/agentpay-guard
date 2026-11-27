import { analyzeLimiter, handleAgentPost } from "@/lib/ai/agentRoute";
import { analyzeIntent } from "@/lib/ai/analyze";
import { AnalyzeRequestSchema } from "@/lib/ai/schemas";

// POST /api/v1/agent/analyze (docs/06 §3.2): Firecrawl (or text) → LLM → Zod-validated
// intent. No chain writes. Errors: 400, 403 POLICY_NOT_SERVED / DEMO_DISABLED, 404,
// 422 LLM_OUTPUT_INVALID / LLM_REFUSED, 502 FIRECRAWL_ERROR / LLM_ERROR, 429.
export const maxDuration = 60;

export async function POST(request: Request) {
  return handleAgentPost(request, analyzeLimiter, "analyze", AnalyzeRequestSchema, analyzeIntent);
}
