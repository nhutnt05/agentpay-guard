import { connection as requestTime } from "next/server";
import { z } from "zod";
import { fail, ok } from "@/lib/api/response";
import { AgentKeyConfigError } from "@/lib/server/agentKeypair";
import { rateLimitRead } from "@/lib/server/guards";
import { getPaymentDeps } from "@/lib/server/paymentDeps";
import { getPaymentStatus, PaymentServiceError } from "@/lib/server/payments";
import { SignatureSchema } from "@/lib/validation/common";

// GET /api/v1/payments/[signature] (docs/06 §3.6): authoritative status from the cluster.
export async function GET(request: Request, ctx: RouteContext<"/api/v1/payments/[signature]">) {
  await requestTime();
  const limited = rateLimitRead(request, "payment-status");
  if (limited) return limited;

  const parsed = z.object({ signature: SignatureSchema }).safeParse(await ctx.params);
  if (!parsed.success) return fail(400, "VALIDATION_ERROR", "invalid signature", parsed.error.issues);

  try {
    const { httpStatus, ...data } = await getPaymentStatus(getPaymentDeps(), parsed.data.signature);
    return ok(data, { status: httpStatus });
  } catch (e) {
    if (e instanceof PaymentServiceError) {
      return Response.json({ ok: false, error: { code: e.code, message: e.message } }, { status: e.httpStatus });
    }
    if (e instanceof AgentKeyConfigError) return fail(500, "CONFIG_ERROR", e.message);
    return fail(502, "RPC_ERROR", "failed to read the transaction from the cluster");
  }
}
