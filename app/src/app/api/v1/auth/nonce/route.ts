import { connection as requestTime } from "next/server";
import { fail, ok } from "@/lib/api/response";
import { rateLimitRead } from "@/lib/server/guards";
import { createSignInChallenge, SessionConfigError } from "@/lib/server/session";
import { PubkeySchema } from "@/lib/validation/common";

// GET /api/v1/auth/nonce?wallet=<pubkey> (T-M4-16): returns the exact message the wallet must
// sign (Phantom `signMessage`). The nonce is HMAC-signed and valid for 5 minutes.
export async function GET(request: Request) {
  await requestTime();
  const limited = rateLimitRead(request, "auth-nonce");
  if (limited) return limited;
  const wallet = PubkeySchema.safeParse(new URL(request.url).searchParams.get("wallet") ?? "");
  if (!wallet.success) return fail(400, "VALIDATION_ERROR", "wallet must be a public key");
  try {
    return ok(createSignInChallenge(wallet.data));
  } catch (e) {
    if (e instanceof SessionConfigError) return fail(500, "CONFIG_ERROR", e.message);
    throw e;
  }
}
