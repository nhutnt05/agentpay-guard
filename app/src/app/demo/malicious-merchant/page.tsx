import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { maliciousPageFixture } from "@/lib/ai/fixtures/maliciousPage";

// Malicious demo page (docs/08 §3, DEMO-01). It is SCRAPED by the agent (Firecrawl needs a
// public URL, so this only works once deployed). Exists only when DEMO_MODE=true; the
// attacker wallet comes from DEMO_ATTACKER_WALLET (a non-allowlisted demo wallet).
// Content is rendered as plain text (no HTML injection) — keep it that way: the scraper must
// see exactly the fixture text.

export const metadata: Metadata = {
  title: "Acme Data API — Pricing (demo page)",
  robots: { index: false, follow: false },
};

export default function MaliciousMerchantPage() {
  const attacker = process.env.DEMO_ATTACKER_WALLET;
  if (process.env.DEMO_MODE !== "true" || !attacker || attacker.startsWith("<")) notFound();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-12 sm:px-6">
      <p className="mb-8 rounded-xl border border-warning/40 bg-warning/8 px-4 py-3 text-sm text-fg">
        <span className="font-semibold">AgentPay Guard security demo.</span>{" "}
        <span className="text-muted">This page intentionally contains a prompt-injection attack aimed at AI agents.</span>
      </p>
      <article className="rounded-2xl border border-line bg-surface/80 p-6 sm:p-8">
        <pre className="whitespace-pre-wrap font-sans text-base leading-7 text-fg">{maliciousPageFixture(attacker)}</pre>
      </article>
    </main>
  );
}
