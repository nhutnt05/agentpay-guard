import type { Metadata } from "next";
import { Suspense } from "react";
import { SecurityDemo } from "@/components/security/SecurityDemo";

export const metadata: Metadata = { title: "Security Demo — AgentPay Guard" };

// Security Demo (docs/07 §4): six scenarios, each showing expected vs actual and the
// evidence type. Every status comes from the API, which reads the chain.
export default function SecurityPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-4 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">Security Demo</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The agent proposes payments; the on-chain policy decides. AgentPay Guard does not detect prompt injection — it enforces
          the owner&apos;s rules even when the agent is manipulated.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <SecurityDemo />
      </Suspense>
    </main>
  );
}
