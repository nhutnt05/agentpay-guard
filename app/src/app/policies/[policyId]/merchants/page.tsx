/**
 * Merchants management page
 * Add/remove merchants from policy allowlist
 */

import { Metadata } from 'next';
import { MerchantsPageClient } from '@/components/policy/MerchantsPageClient';

export const metadata: Metadata = {
  title: 'Manage Merchants | AgentPay Guard',
  description: 'Manage merchant allowlist for payment policy',
};

interface MerchantsPageProps {
  params: Promise<{ policyId: string }>;
}

export default async function MerchantsPage({ params }: MerchantsPageProps) {
  const { policyId } = await params;

  return <MerchantsPageClient policyId={policyId} />;
}
