/**
 * Payments history page
 * Shows all payments executed under this policy
 */

import { Metadata } from 'next';
import { PaymentsPageClient } from '@/components/policy/PaymentsPageClient';

export const metadata: Metadata = {
  title: 'Payment History | AgentPay Guard',
  description: 'View payment history for this policy',
};

interface PaymentsPageProps {
  params: Promise<{ policyId: string }>;
}

export default async function PaymentsPage({ params }: PaymentsPageProps) {
  const { policyId } = await params;

  return <PaymentsPageClient policyId={policyId} />;
}
