import { z } from "zod";
import { fail } from "@/lib/api/response";
import { handlePaymentPost } from "@/lib/server/paymentRoute";
import { PubkeySchema } from "@/lib/validation/common";
import { allowedX402Hosts, payX402 } from "@/lib/x402/client";

// POST /api/v1/agent/x402/pay (F-01, docs/14 design B): the agent pays an HTTP 402 resource
// through the firewall. Disabled unless X402_ALLOWED_HOSTS lists the hosts the server may call.
const X402PayRequestSchema = z
  .object({
    policy: PubkeySchema,
    url: z.string().url().max(2048),
  })
  .strict();

export async function POST(request: Request) {
  const allowedHosts = allowedX402Hosts();
  if (allowedHosts.size === 0) return fail(403, "X402_DISABLED", "x402 is disabled (X402_ALLOWED_HOSTS is empty)");
  return handlePaymentPost(request, "x402", X402PayRequestSchema, (deps, input) =>
    payX402(deps, input, { fetch, allowedHosts }),
  );
}
