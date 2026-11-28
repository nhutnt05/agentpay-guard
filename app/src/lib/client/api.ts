// Typed client for /api/v1 (browser and Node). Never throws on HTTP errors: every call
// returns { http, ok, data?, error? } so callers can show the exact server outcome.

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}

export interface ApiResponse<T = Record<string, unknown>> {
  http: number;
  ok: boolean;
  data?: T;
  error?: ApiError;
}

/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are validated by the server */
export type AnyData = Record<string, any>;

export function createApiClient(baseUrl = "", fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function call(method: "GET" | "POST", path: string, body?: unknown): Promise<ApiResponse<AnyData>> {
    let res: Response;
    try {
      res = await fetchImpl(`${baseUrl}/api/v1${path}`, {
        method,
        headers: body === undefined ? undefined : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
      });
    } catch {
      return { http: 0, ok: false, error: { code: "NETWORK_ERROR", message: "could not reach the server" } };
    }
    let json: { ok?: boolean; data?: AnyData; error?: ApiError } = {};
    try {
      json = await res.json();
    } catch {
      return { http: res.status, ok: false, error: { code: "BAD_RESPONSE", message: "server returned non-JSON" } };
    }
    return { http: res.status, ok: Boolean(json.ok), data: json.data, error: json.error };
  }

  const enc = encodeURIComponent;
  return {
    health: () => call("GET", "/health"),
    policy: (id: string) => call("GET", `/policies/${enc(id)}`),
    merchants: (id: string) => call("GET", `/policies/${enc(id)}/merchants`),
    payments: (id: string, limit = 20) => call("GET", `/policies/${enc(id)}/payments?limit=${limit}`),
    prepare: (body: AnyData) => call("POST", "/payments/prepare", body),
    submit: (body: AnyData) => call("POST", "/payments/submit", body),
    paymentStatus: (signature: string) => call("GET", `/payments/${enc(signature)}`),
    analyze: (body: AnyData) => call("POST", "/agent/analyze", body),
    paymentRequest: (body: AnyData) => call("POST", "/agent/payment-request", body),
    promptInjection: (body: AnyData) => call("POST", "/demo/prompt-injection", body),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
