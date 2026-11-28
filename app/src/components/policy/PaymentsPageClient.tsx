"use client";

import dynamic from "next/dynamic";
import { Container } from "@/components/ui/Container";
import { LoadingBlock } from "@/components/ui/Spinner";

// Client-only: the component uses the browser wallet and the Anchor client.
const PaymentsHistory = dynamic(() => import("@/components/policy/PaymentsHistory").then((m) => ({ default: m.PaymentsHistory })), {
  ssr: false,
  loading: () => <LoadingBlock label="Loading payments…" />,
});

export function PaymentsPageClient({ policyId }: { policyId: string }) {
  return (
    <Container size="lg">
      <PaymentsHistory policyAddress={policyId} />
    </Container>
  );
}
