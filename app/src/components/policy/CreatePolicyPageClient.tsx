/**
 * Client wrapper for Create Policy Page
 * Handles wallet-dependent form rendering
 */

'use client';

import dynamic from 'next/dynamic';
import { Navigation } from '@/components/ui/Navigation';

// Dynamic import to avoid SSR issues with Anchor
const CreatePolicyForm = dynamic(
  () => import('@/components/policy/CreatePolicyForm').then(mod => ({ default: mod.CreatePolicyForm })),
  { ssr: false }
);

export function CreatePolicyPageClient() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-950 to-gray-900">
      <Navigation />
      <main className="flex-1 container mx-auto px-4 py-8">
        <h1 className="text-4xl font-bold mb-8 text-white">Create New Policy</h1>
        <CreatePolicyForm />
      </main>
    </div>
  );
}
