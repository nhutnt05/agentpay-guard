/**
 * Client wrapper for Policies Dashboard Page
 * Handles wallet-dependent rendering
 */

'use client';

import dynamic from 'next/dynamic';
import { Navigation } from '@/components/ui/Navigation';

// Dynamic import to avoid SSR issues with Anchor
const PoliciesDashboard = dynamic(
  () => import('@/components/policy/PoliciesDashboard').then(mod => ({ default: mod.PoliciesDashboard })),
  { ssr: false }
);

export function PoliciesPageClient() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-950 to-gray-900">
      <Navigation />
      <main className="flex-1">
        <PoliciesDashboard />
      </main>
    </div>
  );
}
