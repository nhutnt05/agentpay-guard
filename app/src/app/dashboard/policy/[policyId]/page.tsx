import { redirect } from "next/navigation";

// Superseded by /policies/[policyId] (next.config.ts also redirects this path before it renders).
export default async function DashboardPolicyPage(props: { params: Promise<{ policyId: string }> }) {
  const { policyId } = await props.params;
  redirect(`/policies/${encodeURIComponent(policyId)}`);
}
