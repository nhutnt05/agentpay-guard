"use client";

import dynamic from "next/dynamic";
import { Container } from "@/components/ui/Container";
import { LoadingBlock } from "@/components/ui/Spinner";

// Client-only: the component uses the browser wallet and the Anchor client.
const MerchantsManager = dynamic(() => import("@/components/policy/MerchantsManager").then((m) => ({ default: m.MerchantsManager })), {
  ssr: false,
  loading: () => <LoadingBlock label="Loading merchants…" />,
});

export function MerchantsPageClient({ policyId }: { policyId: string }) {
  return (
    <Container size="lg">
      <MerchantsManager policyAddress={policyId} />
    </Container>
  );
}
