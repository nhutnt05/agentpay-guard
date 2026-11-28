/**
 * Create new policy page
 * Form to initialize a new AgentPolicy account
 */

import { Metadata } from 'next';
import { CreatePolicyPageClient } from '@/components/policy/CreatePolicyPageClient';

export const metadata: Metadata = {
  title: 'Create Policy | AgentPay Guard',
  description: 'Create a new AI agent payment policy',
};

export default function CreatePolicyPage() {
  return <CreatePolicyPageClient />;
}
