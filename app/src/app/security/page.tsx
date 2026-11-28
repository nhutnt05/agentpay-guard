import type { Metadata } from "next";
import { Suspense } from "react";
import { SecurityDemo } from "@/components/security/SecurityDemo";
import { Badge } from "@/components/ui/Badge";
import { Container } from "@/components/ui/Container";
import { PageHeader } from "@/components/ui/SectionHeader";
import { LoadingBlock } from "@/components/ui/Spinner";

export const metadata: Metadata = { title: "Security Demo" };

// Security Demo (docs/07 §4): six scenarios, each showing expected vs actual and the
// evidence type. Every status comes from the API, which reads the chain.
export default function SecurityPage() {
  return (
    <Container size="xl">
      <PageHeader
        eyebrow={<Badge tone="warning">Attack simulation · devnet</Badge>}
        title="Security Demo"
        description="The agent proposes payments; the on-chain policy decides. AgentPay Guard does not try to detect prompt injection — it enforces the owner's rules even when the agent is manipulated."
      />
      <Suspense fallback={<LoadingBlock />}>
        <SecurityDemo />
      </Suspense>
    </Container>
  );
}
