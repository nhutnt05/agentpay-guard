import { BN } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { PROGRAM_ID } from "@/lib/anchor/constants";
import { policyPda, vaultAddress } from "@/lib/anchor/pda";
import { getReadonlyProgram } from "@/lib/anchor/program";
import { MEMO_PROGRAM_ID } from "@/lib/server/agentSigner";
import type { PaymentDeps, PaymentRpc } from "@/lib/server/payments";
import { assertX402Url, payX402 } from "./client";
import {
  decodePaymentRequired,
  decodePaymentResponse,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  type PaymentRequired,
  selectRequirement,
  SOLANA_DEVNET_CAIP2,
} from "./protocol";

// F-01 x402 (docs/14 design B). A fake resource server plays the sponsor: it checks the
// payment transaction the way the x402 SVM spec requires (sponsor = fee payer, not in any
// instruction, signature still missing; agent signed; one memo) and returns a settlement.

const NOW = 1_800_000_000;
const owner = Keypair.generate().publicKey;
const agent = Keypair.generate();
const mint = Keypair.generate().publicKey;
const payTo = Keypair.generate().publicKey;
const sponsor = Keypair.generate().publicKey;
const [policy] = policyPda(owner, new Uint8Array(32).fill(7));
const program = getReadonlyProgram(new Connection("http://127.0.0.1:1"), agent.publicKey);
const SIG = "5uCXVGHUYpCgPBW4qJfyKsaUGov3E12avRn6YzBFQa7CTGPnV1fEAAUgfisvBjHvDQzC31Gdrn6sChPFGSz3Jih8";
const URL_OK = "https://api.merchant.example/premium";
const HOSTS = new Set(["api.merchant.example"]);

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64");

function paymentRequired(over: Partial<PaymentRequired["accepts"][number]> = {}): PaymentRequired {
  return {
    x402Version: 2,
    error: "PAYMENT-SIGNATURE header is required",
    resource: { url: URL_OK },
    accepts: [
      { scheme: "exact", network: "eip155:84532", amount: "1", asset: "0xabc", payTo: "0xdef", maxTimeoutSeconds: 60 },
      {
        scheme: "exact",
        network: SOLANA_DEVNET_CAIP2,
        amount: "2000000",
        asset: mint.toBase58(),
        payTo: payTo.toBase58(),
        maxTimeoutSeconds: 60,
        extra: { feePayer: sponsor.toBase58(), memo: "inv_42" },
        ...over,
      },
    ],
  };
}

async function deps(simulateErr: unknown = null): Promise<PaymentDeps> {
  const policyData = await program.coder.accounts.encode("agentPolicy", {
    owner,
    agent: agent.publicKey,
    mint,
    vault: vaultAddress(policy, mint, TOKEN_PROGRAM_ID),
    policyId: Array(32).fill(7),
    maxPerTx: new BN(10_000_000),
    dailyLimit: new BN(20_000_000),
    spentToday: new BN(0),
    dayIndex: new BN(Math.floor(NOW / 86_400)),
    isPaused: false,
    createdAt: new BN(NOW),
    bump: 255,
  });
  const rpc = {
    getAccountInfoAndContext: async (a: PublicKey) => ({
      context: { slot: 1 },
      value: a.equals(policy) ? { owner: PROGRAM_ID, data: policyData, lamports: 1, executable: false } : null,
    }),
    getAccountInfo: async () => null,
    getSlot: async () => 1,
    getBlockTime: async () => NOW,
    getLatestBlockhash: async () => ({ blockhash: new PublicKey(new Uint8Array(32).fill(3)).toBase58(), lastValidBlockHeight: 9 }),
    simulateTransaction: async () => ({
      value: {
        err: simulateErr,
        logs: simulateErr
          ? ["Program log: AnchorError caused by account: merchant_allowlist. Error Code: AccountNotInitialized. Error Number: 3012."]
          : [],
        unitsConsumed: 1,
      },
    }),
  } as unknown as PaymentRpc;
  return { rpc, program, agent, allowedOwners: new Set([owner.toBase58()]), demoMode: false };
}

/** Fake x402 resource server acting as its own sponsor (merchant-sponsored fees). */
function fakeServer(pr: PaymentRequired, opts: { refuse?: boolean } = {}) {
  const seen: Transaction[] = [];
  const fetchImpl = vi.fn(async (_url: URL | string, init?: RequestInit) => {
    const header = (init?.headers as Record<string, string> | undefined)?.[HEADER_PAYMENT_SIGNATURE];
    if (!header) return new Response("{}", { status: 402, headers: { [HEADER_PAYMENT_REQUIRED]: b64(pr) } });
    const payload = JSON.parse(Buffer.from(header, "base64").toString());
    expect(payload.x402Version).toBe(2);
    expect(payload.accepted.network).toBe(SOLANA_DEVNET_CAIP2);
    const tx = Transaction.from(Buffer.from(payload.payload.transaction, "base64"));
    seen.push(tx);
    if (opts.refuse) {
      return new Response("{}", { status: 402, headers: { [HEADER_PAYMENT_RESPONSE]: b64({ success: false, errorReason: "invalid_payload" }) } });
    }
    return new Response("{\"data\":\"premium\"}", {
      status: 200,
      headers: { [HEADER_PAYMENT_RESPONSE]: b64({ success: true, transaction: SIG, network: SOLANA_DEVNET_CAIP2, payer: agent.publicKey.toBase58() }) },
    });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, seen, calls: fetchImpl };
}

describe("x402 protocol (F-01)", () => {
  it("decodes PAYMENT-REQUIRED and picks the Solana devnet requirement for the policy mint", () => {
    const pr = paymentRequired();
    const decoded = decodePaymentRequired(new Headers({ [HEADER_PAYMENT_REQUIRED]: b64(pr) }), null);
    const sel = selectRequirement(decoded, mint.toBase58());
    expect(sel.requirement.payTo).toBe(payTo.toBase58());
    expect(sel.feePayer).toBe(sponsor.toBase58());
    expect(sel.memo).toBe("inv_42");
  });

  it("refuses other assets, networks, versions and missing sponsors", () => {
    expect(() => selectRequirement(paymentRequired(), Keypair.generate().publicKey.toBase58())).toThrow(/no payable/);
    expect(() => selectRequirement(paymentRequired({ extra: {} }), mint.toBase58())).toThrow(/feePayer/);
    expect(() => decodePaymentRequired(new Headers(), { ...paymentRequired(), x402Version: 1 })).toThrow(/x402Version/);
    expect(decodePaymentResponse(new Headers({ [HEADER_PAYMENT_RESPONSE]: "%%%" }))).toBeNull();
  });

  it("SSRF guard: https + allowlisted host only", () => {
    expect(() => assertX402Url("http://api.merchant.example/x", HOSTS)).toThrow(/https/);
    expect(() => assertX402Url("https://169.254.169.254/latest", HOSTS)).toThrow(/X402_ALLOWED_HOSTS/);
    expect(() => assertX402Url("https://u:p@api.merchant.example/x", HOSTS)).toThrow(/credentials/);
    expect(assertX402Url(URL_OK, HOSTS).hostname).toBe("api.merchant.example");
  });
});

describe("x402 client through the firewall (F-01)", () => {
  it("pays via execute_payment: sponsor is fee payer (unsigned, in no instruction), agent signed, memo set", async () => {
    const server = fakeServer(paymentRequired());
    const r = await payX402(await deps(), { policy: policy.toBase58(), url: URL_OK }, {
      fetch: server.fetchImpl,
      allowedHosts: HOSTS,
      verifySettlement: false,
    });
    expect(r.status).toBe("SUBMITTED");
    expect(r.signature).toBe(SIG);
    expect(r.x402).toMatchObject({ payTo: payTo.toBase58(), amount: "2000000", memo: "inv_42", serverStatus: 200 });

    const tx = server.seen[0];
    expect(tx.feePayer?.equals(sponsor)).toBe(true);
    const sponsorSig = tx.signatures.find((s) => s.publicKey.equals(sponsor));
    expect(sponsorSig?.signature).toBeNull(); // sponsor signs at /settle
    expect(tx.signatures.find((s) => s.publicKey.equals(agent.publicKey))?.signature).not.toBeNull();
    const [pay, memo] = tx.instructions;
    expect(pay.programId.equals(PROGRAM_ID)).toBe(true);
    expect(tx.instructions.every((ix) => ix.keys.every((k) => !k.pubkey.equals(sponsor)))).toBe(true);
    expect(memo.programId.equals(MEMO_PROGRAM_ID)).toBe(true);
    expect(memo.data.toString("utf8")).toBe("inv_42");
  });

  it("payTo not allowlisted → rejected in simulation; nothing signed or sent to the server", async () => {
    const server = fakeServer(paymentRequired());
    const r = await payX402(await deps({ InstructionError: [0, { Custom: 3012 }] }), { policy: policy.toBase58(), url: URL_OK }, {
      fetch: server.fetchImpl,
      allowedHosts: HOSTS,
    });
    expect(r.status).toBe("REJECTED");
    expect(r.reason).toBe("MERCHANT_NOT_ALLOWLISTED");
    expect(r.evidence).toBe("SIMULATION");
    expect(server.calls).toHaveBeenCalledTimes(1); // only the 402 probe
  });

  it("server refuses the payment → FAILED, never CONFIRMED", async () => {
    const server = fakeServer(paymentRequired(), { refuse: true });
    const r = await payX402(await deps(), { policy: policy.toBase58(), url: URL_OK }, {
      fetch: server.fetchImpl,
      allowedHosts: HOSTS,
    });
    expect(r.status).toBe("FAILED");
    expect(r.message).toMatch(/invalid_payload/);
  });

  it("resource that does not answer 402 is not paid", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
    const r = await payX402(await deps(), { policy: policy.toBase58(), url: URL_OK }, { fetch: fetchImpl, allowedHosts: HOSTS });
    expect(r.status).toBe("REJECTED");
    expect(r.message).toMatch(/did not ask for payment/);
  });
});
