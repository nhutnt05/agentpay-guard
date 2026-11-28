"use client";

import dynamic from "next/dynamic";
import { Container } from "@/components/ui/Container";
import { LoadingBlock } from "@/components/ui/Spinner";

// Client-only: the component uses the browser wallet and the Anchor client.
const PoliciesDashboard = dynamic(() => import("@/components/policy/PoliciesDashboard").then((m) => ({ default: m.PoliciesDashboard })), {
  ssr: false,
  loading: () => <LoadingBlock label="Loading your policies…" />,
});

export function PoliciesPageClient() {
  return (
    <Container size="lg">
      <PoliciesDashboard />
    </Container>
  );
}
