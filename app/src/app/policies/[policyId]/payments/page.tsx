/**
 * Payments history page
 * Shows all payments executed under this policy
 */

import { Metadata } from 'next';
import { PaymentsHistory } from '@/components/policy/PaymentsHistory';
import { Navigation } from '@/components/ui/Navigation';

export const metadata: Metadata = {
  title: 'Payment History | AgentPay Guard',
  description: 'View payment history for this policy',
};

interface PaymentsPageProps {
  params: Promise<{ policyId: string }>;
}

export default async function PaymentsPage({ params }: PaymentsPageProps) {
  const { policyId } = await params;

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-950 to-gray-900">
      <Navigation />
      <main className="flex-1">
        <PaymentsHistory policyAddress={policyId} />
      </main>
    </div>
  );
}
