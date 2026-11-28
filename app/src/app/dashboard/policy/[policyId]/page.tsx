import type { Metadata } from "next";
import { Suspense } from "react";
import { PolicyDetailsContent } from "@/components/policy/PolicyDetailsContent";

export const metadata: Metadata = { title: "Policy Details — AgentPay Guard" };

export default async function PolicyDetailsPage(props: { params: Promise<{ policyId: string }> }) {
  const params = await props.params;
  
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8">
      <Suspense fallback={<div className="text-sm text-zinc-500">Loading policy...</div>}>
        <PolicyDetailsContent policyId={params.policyId} />
      </Suspense>
    </main>
  );
}
