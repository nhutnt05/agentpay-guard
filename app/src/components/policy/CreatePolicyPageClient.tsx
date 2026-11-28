"use client";

import dynamic from "next/dynamic";
import { Container } from "@/components/ui/Container";
import { LoadingBlock } from "@/components/ui/Spinner";

// Client-only: the component uses the browser wallet and the Anchor client.
const CreatePolicyForm = dynamic(() => import("@/components/policy/CreatePolicyForm").then((m) => ({ default: m.CreatePolicyForm })), {
  ssr: false,
  loading: () => <LoadingBlock label="Loading…" />,
});

export function CreatePolicyPageClient() {
  return (
    <Container size="lg">
      <CreatePolicyForm />
    </Container>
  );
}
