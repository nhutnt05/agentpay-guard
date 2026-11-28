/**
 * Payments history component
 * Shows payment receipts for this policy
 */

'use client';

import { useWallet } from '@solana/wallet-adapter-react';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';

interface PaymentsHistoryProps {
  policyAddress: string;
}

export function PaymentsHistory({ policyAddress }: PaymentsHistoryProps) {
  const { publicKey } = useWallet();

  if (!publicKey) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Card>
          <CardContent className="text-center py-12">
            <h2 className="text-2xl font-bold text-white mb-4">
              Connect Your Wallet
            </h2>
            <p className="text-gray-400">
              Please connect your wallet to view payment history
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <SectionHeader
          title="Payment History"
          description="All payments executed under this policy"
        />
        <div className="mt-4">
          <Link href={`/policies/${policyAddress}`}>
            <Button>← Back to Policy</Button>
          </Link>
        </div>
      </div>

      {/* Payment List - TODO: Fetch PaymentReceipt accounts */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Payments</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-gray-400 text-center py-8">
            No payments yet. Payment receipts will appear here after the agent executes transactions.
          </p>
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>About Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-gray-400">
            <p>
              • Each payment creates a PaymentReceipt PDA on-chain
            </p>
            <p>
              • Receipts include merchant, amount, timestamp, and request hash
            </p>
            <p>
              • Receipts prevent replay attacks (same request_hash cannot be paid twice)
            </p>
            <p>
              • All receipts are permanent and auditable on Solana
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
