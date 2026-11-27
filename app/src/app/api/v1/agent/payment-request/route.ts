import { handleAgentPost, paymentRequestLimiter } from "@/lib/ai/agentRoute";
import { normalizePaymentRequest } from "@/lib/ai/analyze";
import { PaymentRequestBodySchema } from "@/lib/ai/schemas";

// POST /api/v1/agent/payment-request (docs/06 §3.3): normalize an intent into a PENDING
// payment request. Mint and decimals always come from chain; stateless (no DB).
export async function POST(request: Request) {
  return handleAgentPost(request, paymentRequestLimiter, "payment-request", PaymentRequestBodySchema, normalizePaymentRequest);
}
