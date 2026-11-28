import { connection as requestTime } from "next/server";
import { ok } from "@/lib/api/response";
import { readSessionWallet } from "@/lib/server/session";

// GET /api/v1/auth/session (T-M4-16): the signed-in wallet (or null) and whether payment
// routes require an owner session on this server.
export async function GET(request: Request) {
  await requestTime();
  return ok({
    wallet: readSessionWallet(request.headers.get("cookie")),
    ownerSessionRequired: process.env.REQUIRE_OWNER_SESSION === "true",
  });
}
