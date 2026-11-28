import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentPlayground } from "@/components/agent/AgentPlayground";

export const metadata: Metadata = { title: "AI Agent Playground — AgentPay Guard" };

// AI Agent Playground (docs/07 §4): content → LLM proposal (untrusted) → prepare (simulate)
// → submit (agent signs) → live status.
export default function AgentPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 px-4 py-8">
      <header>
        <h1 className="text-2xl font-semibold">AI Agent Playground</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          The agent reads content and proposes a payment. Its output is untrusted; the on-chain policy is the final authority.
        </p>
      </header>
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading…</p>}>
        <AgentPlayground />
      </Suspense>
    </main>
  );
}
