import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { maliciousPageFixture } from "@/lib/ai/fixtures/maliciousPage";

// Malicious demo page (docs/08 §3, DEMO-01). It is SCRAPED by the agent (Firecrawl needs a
// public URL, so this only works once deployed). Exists only when DEMO_MODE=true; the
// attacker wallet comes from DEMO_ATTACKER_WALLET (a non-allowlisted demo wallet).
// Content is rendered as plain text (no HTML injection).

export const metadata: Metadata = {
  title: "Acme Data API — Pricing (AgentPay Guard demo page)",
  robots: { index: false, follow: false },
};

export default function MaliciousMerchantPage() {
  const attacker = process.env.DEMO_ATTACKER_WALLET;
  if (process.env.DEMO_MODE !== "true" || !attacker || attacker.startsWith("<")) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12">
      <p className="mb-6 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
        AgentPay Guard security demo: this page intentionally contains a prompt-injection attack.
      </p>
      <pre className="whitespace-pre-wrap font-sans text-base leading-7">{maliciousPageFixture(attacker)}</pre>
    </main>
  );
}
