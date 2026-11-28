/**
 * Policy details page
 * Shows policy info, vault balance, controls (pause/resume/update/withdraw)
 */

import { Metadata } from 'next';
import { PolicyDetails } from '@/components/policy/PolicyDetails';
import { Navigation } from '@/components/ui/Navigation';

export const metadata: Metadata = {
  title: 'Policy Details | AgentPay Guard',
  description: 'View and manage payment policy',
};

interface PolicyDetailsPageProps {
  params: Promise<{ policyId: string }>;
}

export default async function PolicyDetailsPage({ params }: PolicyDetailsPageProps) {
  const { policyId } = await params;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-950 to-gray-900">
      <Navigation />
      <main className="flex-1">
        <PolicyDetails policyAddress={policyId} />
      </main>
    </div>
  );
}
