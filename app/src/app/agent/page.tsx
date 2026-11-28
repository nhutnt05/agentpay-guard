import type { Metadata } from "next";
import { Suspense } from "react";
import { AgentPlayground } from "@/components/agent/AgentPlayground";
import { Badge } from "@/components/ui/Badge";
import { Container } from "@/components/ui/Container";
import { PageHeader } from "@/components/ui/SectionHeader";
import { LoadingBlock } from "@/components/ui/Spinner";

export const metadata: Metadata = { title: "AI Playground" };

// AI Agent Playground (docs/07 §4): content → LLM proposal (untrusted) → prepare (simulate)
// → submit (agent signs) → live status.
export default function AgentPage() {
  return (
    <Container size="xl">
      <PageHeader
        eyebrow={<Badge tone="info">Live on devnet</Badge>}
        title="AI Playground"
        description="Let an AI agent read a page and propose a payment. Its output is untrusted — the on-chain policy is the final authority."
      />
      <Suspense fallback={<LoadingBlock />}>
        <AgentPlayground />
      </Suspense>
    </Container>
  );
}
