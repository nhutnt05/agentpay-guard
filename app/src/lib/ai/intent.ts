import { PublicKey } from "@solana/web3.js";
import { parseDecimalAmount } from "@/lib/solana/amounts";
import type { LlmPaymentProposal, PaymentIntent } from "./schemas";
import { PaymentIntentSchema } from "./schemas";

// Strict conversion of the untrusted LLM proposal into a canonical PaymentIntent
// (docs/08 §2.3). Problems become `issues` (→ intentValid: false), never exceptions.

export interface IntentConversion {
  intent: PaymentIntent | null;
  intentValid: boolean;
  issues: string[];
}

const BASE58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function parseWallet(value: string | null, label: string, issues: string[]): PublicKey | null {
  if (!value) {
    issues.push(`${label} is missing`);
    return null;
  }
  const trimmed = value.trim();
  if (!BASE58.test(trimmed)) {
    issues.push(`${label} is not a base58 public key`);
    return null;
  }
  try {
    return new PublicKey(trimmed);
  } catch {
    issues.push(`${label} is not a valid public key`);
    return null;
  }
}

export function toPaymentIntent(
  proposal: LlmPaymentProposal,
  policy: { mint: PublicKey; decimals: number },
  sourceUrl?: string,
): IntentConversion {
  const issues: string[] = [];
  if (!proposal.shouldPay) {
    return { intent: null, intentValid: false, issues: ["the model did not propose a payment"] };
  }

  const merchant = parseWallet(proposal.merchant, "merchant", issues);

  let amount: bigint | null = null;
  if (!proposal.amountDecimal) {
    issues.push("amount is missing");
  } else {
    try {
      amount = parseDecimalAmount(proposal.amountDecimal.trim(), policy.decimals);
      if (amount === 0n) {
        issues.push("amount must be greater than zero");
        amount = null;
      }
    } catch (e) {
      issues.push(`amount is invalid: ${(e as Error).message}`);
    }
  }

  // AI-05: if the content names a mint, it must be the policy's on-chain mint.
  if (proposal.mint) {
    const stated = parseWallet(proposal.mint, "mint", issues);
    if (stated && !stated.equals(policy.mint)) {
      issues.push("the stated token mint differs from the policy mint");
    }
  }

  const reason = proposal.reason.slice(0, 500);
  if (!merchant || amount === null || issues.length) {
    return { intent: null, intentValid: false, issues };
  }

  const candidate = {
    merchant: merchant.toBase58(),
    amount: amount.toString(),
    mint: policy.mint.toBase58(),
    reason,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
  const checked = PaymentIntentSchema.safeParse(candidate);
  if (!checked.success) {
    return { intent: null, intentValid: false, issues: checked.error.issues.map((i) => i.message) };
  }
  return { intent: checked.data, intentValid: true, issues: [] };
}
