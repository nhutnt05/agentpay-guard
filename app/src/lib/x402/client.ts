import "server-only";
import { explorerTxUrl } from "@/lib/solana/explorer";
import {
  getPaymentStatus,
  type PaymentDeps,
  type PaymentResult,
  PaymentServiceError,
  prepareSponsoredPayment,
  servedPolicyMint,
} from "@/lib/server/payments";
import { PrepareRequestSchema } from "@/lib/validation/payments";
import { MAX_REQUEST_TTL_SECONDS } from "@/lib/anchor/constants";
import { PublicKey } from "@solana/web3.js";
import {
  decodePaymentRequired,
  decodePaymentResponse,
  encodePaymentSignature,
  HEADER_PAYMENT_SIGNATURE,
  randomMemoNonce,
  selectRequirement,
  type SettlementResponse,
  X402ProtocolError,
} from "./protocol";

// F-01 x402 client (docs/14 design B). The agent pays an HTTP 402 resource THROUGH the firewall:
// the x402 `exact` requirement becomes a normal AgentPay Guard payment (allowlist, limits,
// simulation), the transaction pays via `execute_payment` from the policy vault, and the
// sponsor named in the 402 (facilitator or merchant) is the fee payer and settles it.
// A payTo that is not allowlisted is refused by the program in simulation — nothing is signed.

export interface X402Info {
  url: string;
  network: string;
  payTo: string;
  amount: string;
  sponsor: string;
  memo: string;
  /** HTTP status of the paid retry. */
  serverStatus: number | null;
  settlement: SettlementResponse | null;
}

export type X402Result = PaymentResult & { x402?: X402Info };

export interface X402Options {
  fetch: typeof fetch;
  /** Hostnames the server may contact (fail closed when empty). */
  allowedHosts: ReadonlySet<string>;
  /** Wait for confirmation of the settled signature (default true). */
  verifySettlement?: boolean;
}

/** SSRF guard: https only, exact allowlisted host, no credentials, default port. */
export function assertX402Url(raw: string, allowedHosts: ReadonlySet<string>): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new PaymentServiceError(400, "VALIDATION_ERROR", "url is not a valid URL");
  }
  if (url.protocol !== "https:") throw new PaymentServiceError(400, "VALIDATION_ERROR", "x402 url must use https");
  if (url.username || url.password || url.port) {
    throw new PaymentServiceError(400, "VALIDATION_ERROR", "x402 url must not contain credentials or a port");
  }
  if (!allowedHosts.has(url.hostname.toLowerCase())) {
    throw new PaymentServiceError(403, "X402_HOST_NOT_ALLOWED", "host is not in X402_ALLOWED_HOSTS");
  }
  return url;
}

async function bodyOf(res: Response): Promise<unknown> {
  const text = (await res.text()).slice(0, 64_000);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function payX402(
  deps: PaymentDeps,
  input: { policy: string; url: string },
  opts: X402Options,
): Promise<X402Result> {
  const url = assertX402Url(input.url, opts.allowedHosts);
  const mint = await servedPolicyMint(deps, input.policy);

  const first = await opts.fetch(url, { method: "GET", redirect: "manual" });
  if (first.status !== 402) {
    return {
      httpStatus: 409,
      status: "REJECTED",
      reason: "UNKNOWN_ERROR",
      message: `resource did not ask for payment (HTTP ${first.status})`,
    };
  }
  let selected;
  let paymentRequired;
  try {
    paymentRequired = decodePaymentRequired(first.headers, await bodyOf(first));
    selected = selectRequirement(paymentRequired, mint);
  } catch (e) {
    if (e instanceof X402ProtocolError) throw new PaymentServiceError(422, "X402_UNSUPPORTED", e.message);
    throw e;
  }
  const r = selected.requirement;
  const memo = selected.memo ?? randomMemoNonce();
  const info: X402Info = {
    url: url.toString(),
    network: r.network,
    payTo: r.payTo,
    amount: r.amount,
    sponsor: selected.feePayer,
    memo,
    serverStatus: null,
    settlement: null,
  };

  const prepareInput = PrepareRequestSchema.parse({
    policy: input.policy,
    merchant: r.payTo,
    amount: r.amount,
    expiresInSeconds: Math.min(Math.max(r.maxTimeoutSeconds, 30), MAX_REQUEST_TTL_SECONDS),
  });
  const sponsored = await prepareSponsoredPayment(deps, prepareInput, {
    feePayer: new PublicKey(selected.feePayer),
    memo,
    recentBlockhash: selected.recentBlockhash ?? undefined,
  });
  if (!sponsored.ok) return { ...sponsored.result, x402: info }; // policy said no: nothing signed

  const paid = await opts.fetch(url, {
    method: "GET",
    redirect: "manual",
    headers: {
      [HEADER_PAYMENT_SIGNATURE]: encodePaymentSignature(paymentRequired, r, sponsored.payment.transactionBase64),
    },
  });
  info.serverStatus = paid.status;
  info.settlement = decodePaymentResponse(paid.headers);
  const preparedPayment = sponsored.payment.preparedPayment;
  const signature = info.settlement?.success ? info.settlement.transaction : undefined;

  if (!paid.ok || !signature) {
    return {
      httpStatus: 502,
      status: "FAILED",
      reason: "UNKNOWN_ERROR",
      message: `x402 server did not settle the payment (HTTP ${paid.status}${
        info.settlement?.errorReason ? `, ${info.settlement.errorReason}` : ""
      })`,
      preparedPayment,
      x402: info,
    };
  }

  const base: X402Result = {
    httpStatus: 202,
    status: "SUBMITTED",
    signature,
    explorerUrl: explorerTxUrl(signature),
    preparedPayment,
    message: "settled by the x402 sponsor; confirm with GET /payments/{signature}",
    x402: info,
  };
  if (opts.verifySettlement === false) return base;
  // Never trust the sponsor's word alone: CONFIRMED needs a successful tx AND our receipt.
  try {
    const st = await getPaymentStatus(deps, signature);
    if (st.status === "CONFIRMED") {
      return { ...base, httpStatus: 200, status: "CONFIRMED", evidence: "ONCHAIN", receipt: st.payment?.receipt };
    }
    if (st.error) {
      return { ...base, httpStatus: 422, status: st.status, evidence: "ONCHAIN", reason: st.error.reason };
    }
  } catch {
    // not visible yet → stay SUBMITTED
  }
  return base;
}

/** `X402_ALLOWED_HOSTS` (comma-separated hostnames); empty = x402 disabled. */
export function allowedX402Hosts(raw = process.env.X402_ALLOWED_HOSTS): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  );
}
