/**
 * Client wrapper for Merchants Management Page
 * Handles wallet-dependent merchants management rendering
 */

'use client';

import dynamic from 'next/dynamic';
import { Navigation } from '@/components/ui/Navigation';

// Dynamic import to avoid SSR issues with Anchor
const MerchantsManager = dynamic(
  () => import('@/components/policy/MerchantsManager').then(mod => ({ default: mod.MerchantsManager })),
  { ssr: false }
);

export function MerchantsPageClient({ policyId }: { policyId: string }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-950 to-gray-900">
      <Navigation />
      <main className="flex-1">
        <MerchantsManager policyAddress={policyId} />
      </main>
    </div>
  );
}
