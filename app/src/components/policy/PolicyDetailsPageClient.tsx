"use client";

import dynamic from "next/dynamic";
import { Container } from "@/components/ui/Container";
import { LoadingBlock } from "@/components/ui/Spinner";

// Client-only: the component uses the browser wallet and the Anchor client.
const PolicyDetails = dynamic(() => import("@/components/policy/PolicyDetails").then((m) => ({ default: m.PolicyDetails })), {
  ssr: false,
  loading: () => <LoadingBlock label="Loading policy…" />,
});

export function PolicyDetailsPageClient({ policyId }: { policyId: string }) {
  return (
    <Container size="lg">
      <PolicyDetails policyAddress={policyId} />
    </Container>
  );
}
