// API envelope (docs/06 §2): { ok: true, data } | { ok: false, error: { code, message, details? } }.

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "NOT_A_POLICY"
  | "RATE_LIMITED"
  | "RPC_ERROR"
  | "CONFIG_ERROR"
  | "INTERNAL_ERROR";

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json({ ok: true, data }, init);
}

export function fail(
  status: number,
  code: ApiErrorCode,
  message: string,
  details?: unknown,
  headers?: HeadersInit,
): Response {
  return Response.json(
    { ok: false, error: { code, message, ...(details === undefined ? {} : { details }) } },
    { status, headers },
  );
}
