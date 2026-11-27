import { handlePaymentPost } from "@/lib/server/paymentRoute";
import { submitPayment } from "@/lib/server/payments";
import { SubmitRequestSchema } from "@/lib/validation/payments";

// POST /api/v1/payments/submit (docs/06 §3.5): CONFIRMED (200), SUBMITTED (202, poll
// GET /payments/:signature), REJECTED (409 precheck / 422 simulation or on-chain), FAILED (502),
// HASH_MISMATCH (400), POLICY_NOT_SERVED (403).

// Confirmation wait is bounded at 25 s inside the service; leave headroom for RPC calls.
export const maxDuration = 45;

export async function POST(request: Request) {
  return handlePaymentPost(request, "submit", SubmitRequestSchema, submitPayment);
}
