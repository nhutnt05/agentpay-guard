import { handlePaymentPost } from "@/lib/server/paymentRoute";
import { preparePayment } from "@/lib/server/payments";
import { PrepareRequestSchema } from "@/lib/validation/payments";

// POST /api/v1/payments/prepare (docs/06 §3.4): READY_TO_SIGN (200), REJECTED by
// precheck (409) or simulation (422, no signature), FAILED (502).
export async function POST(request: Request) {
  return handlePaymentPost(request, "prepare", PrepareRequestSchema, preparePayment);
}
