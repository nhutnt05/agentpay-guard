/**
 * Merchants management page
 * Add/remove merchants from policy allowlist
 */

import { Metadata } from 'next';
import { MerchantsManager } from '@/components/policy/MerchantsManager';
import { Navigation } from '@/components/ui/Navigation';

export const metadata: Metadata = {
  title: 'Manage Merchants | AgentPay Guard',
  description: 'Manage merchant allowlist for payment policy',
};

interface MerchantsPageProps {
  params: Promise<{ policyId: string }>;
}

export default async function MerchantsPage({ params }: MerchantsPageProps) {
  const { policyId } = await params;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-950 to-gray-900">
      <Navigation />
      <main className="flex-1">
        <MerchantsManager policyAddress={policyId} />
      </main>
    </div>
  );
}
