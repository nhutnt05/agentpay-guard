/**
 * Policies dashboard - list all policies owned by connected wallet
 */

'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Badge } from '@/components/ui/Badge';
import { short } from '@/components/ui/ExplorerLink';
import { formatBaseUnits } from '@/lib/solana/amounts';
import { useOwnerPolicies } from '@/lib/wallet/useOwnerPolicies';

export function PoliciesDashboard() {
  const { publicKey } = useWallet();
  const { policies, loading, error } = useOwnerPolicies(publicKey);

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

      {/* Policy list, read from chain (owner memcmp on AgentPolicy accounts) */}
      {loading ? (
        <p className="text-gray-400">Loading policies…</p>
      ) : error ? (
        <Card>
          <CardContent className="py-4 text-sm text-red-400">{error}</CardContent>
        </Card>
      ) : policies.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {policies.map((p) => (
            <Link key={p.address} href={`/policies/${p.address}`}>
              <Card className="hover:border-[#14F195]">
                <CardHeader>
                  <CardTitle className="flex items-start justify-between">
                    <span className="font-mono text-base">{short(p.address)}</span>
                    <Badge tone={p.isPaused ? 'warning' : 'success'}>{p.isPaused ? 'Paused' : 'Active'}</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <div className="text-gray-500">Vault</div>
                    <div className="text-white">
                      {p.vaultBalance === null ? '—' : formatBaseUnits(p.vaultBalance, p.decimals)}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500">Spent today / limit</div>
                    <div className="text-white">
                      {formatBaseUnits(p.effectiveSpentToday, p.decimals)} / {formatBaseUnits(p.dailyLimit, p.decimals)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Getting Started</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-400 mb-6">
              You haven&apos;t created any policies yet. Create your first policy to start
              securing your AI agent payments.
            </p>
            <Link href="/policies/new">
              <Button>Create Your First Policy</Button>
            </Link>
          </CardContent>
        </Card>
      )}

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
