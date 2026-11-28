/**
 * Policies list page (Dashboard)
 * Shows all policies owned by connected wallet
 */

import { Metadata } from 'next';
import { PoliciesDashboard } from '@/components/policy/PoliciesDashboard';
import { Navigation } from '@/components/ui/Navigation';

export const metadata: Metadata = {
  title: 'My Policies | AgentPay Guard',
  description: 'Manage your AI agent payment policies',
};

export default function PoliciesPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-950 to-gray-900">
      <Navigation />
      <main className="flex-1">
        <PoliciesDashboard />
      </main>
    </div>
  );
}
