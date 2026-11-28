/**
 * Create new policy page
 * Form to initialize a new AgentPolicy account
 */

import { Metadata } from 'next';
import { CreatePolicyForm } from '@/components/policy/CreatePolicyForm';
import { Navigation } from '@/components/ui/Navigation';

export const metadata: Metadata = {
  title: 'Create Policy | AgentPay Guard',
  description: 'Create a new AI agent payment policy',
};

export default function CreatePolicyPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-b from-gray-950 to-gray-900">
      <Navigation />
      <main className="flex-1">
        <CreatePolicyForm />
      </main>
    </div>
  );
}
