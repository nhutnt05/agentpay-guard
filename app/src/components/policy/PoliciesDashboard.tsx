/**
 * Policies dashboard - list all policies owned by connected wallet
 */

'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';

export function PoliciesDashboard() {
  const { publicKey } = useWallet();

  if (!publicKey) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-white mb-4">
            Connect Your Wallet
          </h1>
          <p className="text-gray-400 mb-8">
            Connect your Phantom or Solflare wallet to view and manage your payment policies
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8 flex items-center justify-between">
        <SectionHeader
          title="My Policies"
          description="Manage your AI agent payment policies"
        />
        <Link href="/policies/new">
          <Button>Create Policy</Button>
        </Link>
      </div>

      {/* Policy List - TODO: Fetch from getProgramAccounts */}
      <Card>
        <CardHeader>
          <CardTitle>Getting Started</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400 mb-6">
            You haven't created any policies yet. Create your first policy to start
            securing your AI agent payments.
          </p>
          <Link href="/policies/new">
            <Button>Create Your First Policy</Button>
          </Link>
        </CardContent>
      </Card>

      {/* Info Cards */}
      <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              💰 Set Spending Limits
            </h3>
            <p className="text-gray-400 text-sm">
              Control exactly how much your AI agent can spend per transaction and per day
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <h3 className="text-lg font-semibold text-white mb-2">
              🛡️ AI-Powered Security
            </h3>
            <p className="text-gray-400 text-sm">
              Intent analysis automatically detects and blocks malicious merchants
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
