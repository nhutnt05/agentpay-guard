/**
 * Policies list page (Dashboard)
 * Shows all policies owned by connected wallet
 */

import { Metadata } from 'next';
import { PoliciesPageClient } from '@/components/policy/PoliciesPageClient';

export const metadata: Metadata = {
  title: 'My Policies | AgentPay Guard',
  description: 'Manage your AI agent payment policies',
};

export default function PoliciesPage() {
  return <PoliciesPageClient />;
}
