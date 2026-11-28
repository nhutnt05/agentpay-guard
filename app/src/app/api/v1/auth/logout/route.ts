import { SESSION_COOKIE } from "@/lib/server/session";

// POST /api/v1/auth/logout (T-M4-16): clears the session cookie.
export async function POST() {
  return Response.json(
    { ok: true, data: { wallet: null } },
    { headers: { "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0` } },
  );
}
