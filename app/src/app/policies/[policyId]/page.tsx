/**
 * Policy details page
 * Shows policy info, vault balance, controls (pause/resume/update/withdraw)
 */

import { Metadata } from 'next';
import { PolicyDetailsPageClient } from '@/components/policy/PolicyDetailsPageClient';

export const metadata: Metadata = {
  title: 'Policy Details | AgentPay Guard',
  description: 'View and manage payment policy',
};

interface PolicyDetailsPageProps {
  params: Promise<{ policyId: string }>;
}

export default async function PolicyDetailsPage({ params }: PolicyDetailsPageProps) {
  const { policyId } = await params;

  return <PolicyDetailsPageClient policyId={policyId} />;
}
