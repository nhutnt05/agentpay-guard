/**
 * Client wrapper for Policy Details Page
 * Handles wallet-dependent policy details rendering
 */

'use client';

import dynamic from 'next/dynamic';
import { Navigation } from '@/components/ui/Navigation';

// Dynamic import to avoid SSR issues with Anchor
const PolicyDetails = dynamic(
  () => import('@/components/policy/PolicyDetails').then(mod => ({ default: mod.PolicyDetails })),
  { ssr: false }
);

export function PolicyDetailsPageClient({ policyId }: { policyId: string }) {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-950 to-gray-900">
      <Navigation />
      <main className="flex-1">
        <PolicyDetails policyAddress={policyId} />
      </main>
    </div>
  );
}
