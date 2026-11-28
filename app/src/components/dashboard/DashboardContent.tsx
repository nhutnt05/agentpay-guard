"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { short } from "@/components/ui/ExplorerLink";
import { formatBaseUnits } from "@/lib/solana/amounts";
import { type OwnerPolicySummary, useOwnerPolicies } from "@/lib/wallet/useOwnerPolicies";

export function DashboardContent() {
  const { publicKey, connected } = useWallet();
  const { policies, loading, error } = useOwnerPolicies(connected ? publicKey : null);

  if (!connected) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <div className="text-center">
            <h3 className="text-lg font-semibold text-zinc-100">Connect Your Wallet</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Connect your Solana wallet to view and manage your payment policies
            </p>
          </div>
          <WalletMultiButton />
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with wallet info */}
      <Card>
        <CardContent className="flex items-center justify-between py-4">
          <div>
            <div className="text-sm text-zinc-400">Connected Wallet</div>
            <div className="mt-1 font-mono text-lg text-zinc-100">
              {short(publicKey?.toBase58())}
            </div>
          </div>
          <WalletMultiButton />
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-between">
        <Link href="/dashboard/new">
          <Button variant="primary">Create New Policy</Button>
        </Link>
      </div>

      {/* Policies list */}
      {loading ? (
        <div className="text-center text-sm text-zinc-400">Loading policies...</div>
      ) : error ? (
        <Card variant="danger">
          <CardContent className="py-4 text-sm text-red-400">{error}</CardContent>
        </Card>
      ) : policies.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-zinc-800">
              <svg className="h-8 w-8 text-zinc-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-zinc-100">No policies yet</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Create your first policy to start protecting AI agent payments
            </p>
            <div className="mt-4">
              <Link href="/dashboard/new">
                <Button variant="primary">Create Policy</Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {policies.map((policy) => (
            <PolicyCard key={policy.address} policy={policy} />
          ))}
        </div>
      )}
    </div>
  );
}

function PolicyCard({ policy }: { policy: OwnerPolicySummary }) {
  const { decimals, dailyLimit, effectiveSpentToday } = policy;
  const pct = dailyLimit > 0n ? Number((effectiveSpentToday * 100n) / dailyLimit) : 0;

  return (
    <Link href={`/dashboard/policy/${policy.address}`}>
      <Card className="transition-base hover:border-[#14F195]">
        <CardHeader>
          <CardTitle className="flex items-start justify-between">
            <span className="font-mono text-base">{short(policy.address)}</span>
            <Badge tone={policy.isPaused ? "warning" : "success"}>
              {policy.isPaused ? "Paused" : "Active"}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-zinc-500">Vault Balance</div>
              <div className="font-medium text-zinc-100">
                {policy.vaultBalance === null ? "—" : formatBaseUnits(policy.vaultBalance, decimals)}
              </div>
            </div>
            <div>
              <div className="text-zinc-500">Daily Limit</div>
              <div className="font-medium text-zinc-100">{formatBaseUnits(dailyLimit, decimals)}</div>
            </div>
          </div>

          <div>
            <div className="mb-1 flex justify-between text-xs text-zinc-500">
              <span>Spent Today</span>
              <span>
                {formatBaseUnits(effectiveSpentToday, decimals)} / {formatBaseUnits(dailyLimit, decimals)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800">
              <div className="h-full bg-[#14F195] transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
