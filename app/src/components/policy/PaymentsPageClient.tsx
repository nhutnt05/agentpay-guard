/**
 * Client wrapper for Payments History Page
 * Handles wallet-dependent payments history rendering
 */

'use client';

import dynamic from 'next/dynamic';
import { Navigation } from '@/components/ui/Navigation';

// Dynamic import to avoid SSR issues with Anchor
const PaymentsHistory = dynamic(
  () => import('@/components/policy/PaymentsHistory').then(mod => ({ default: mod.PaymentsHistory })),
  { ssr: false }
);

export function PaymentsPageClient({ policyId }: { policyId: string }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-950 to-gray-900">
      <Navigation />
      <main className="flex-1">
        <PaymentsHistory policyAddress={policyId} />
      </main>
    </div>
  );
}
