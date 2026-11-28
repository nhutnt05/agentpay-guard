/**
 * Payment history of a policy, read from chain via GET /api/v1/policies/[id]/payments:
 * live receipts, payments whose receipt was closed (F-02), and rejected on-chain attempts.
 */

'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { ExplorerLink, short } from '@/components/ui/ExplorerLink';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { MINT_DECIMALS } from '@/lib/anchor/constants';
import { type AnyData, createApiClient } from '@/lib/client/api';
import { formatBaseUnits } from '@/lib/solana/amounts';

const api = createApiClient();

interface PaymentsHistoryProps {
  policyAddress: string;
}

function when(ts: number | null | undefined) {
  return ts ? new Date(ts * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC' : '—';
}

export function PaymentsHistory({ policyAddress }: PaymentsHistoryProps) {
  const [items, setItems] = useState<AnyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await api.payments(policyAddress, 50);
    if (res.ok) setItems((res.data?.items as AnyData[]) ?? []);
    else setError(res.error?.message ?? 'Failed to load payments');
    setLoading(false);
  }, [policyAddress]);

  useEffect(() => {
    // Fetch on mount / policy change; state is set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <SectionHeader title="Payment History" description="Payments and rejected attempts under this policy, read from chain" />
        <div className="mt-4 flex gap-3">
          <Link href={`/policies/${policyAddress}`}>
            <Button>← Back to Policy</Button>
          </Link>
          <Button variant="secondary" onClick={() => void load()} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity (up to 50)</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-gray-400 text-center py-8">Loading…</p>
          ) : error ? (
            <p className="text-red-400 text-center py-8">{error}</p>
          ) : items.length === 0 ? (
            <p className="text-gray-400 text-center py-8">No payments or rejected attempts yet.</p>
          ) : (
            <ul className="divide-y divide-gray-800">
              {items.map((it) => (
                <li key={it.receipt ?? it.signature} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div className="flex items-center gap-3">
                    {it.kind === 'FAILED_TX' ? (
                      <Badge tone="danger">{it.reason ?? 'REJECTED'}</Badge>
                    ) : (
                      <Badge tone="success">{it.receiptClosed ? 'Paid · receipt closed' : 'Paid'}</Badge>
                    )}
                    <span className="text-gray-400">{when(it.timestamp)}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    {it.amount && (
                      <span className="text-white">
                        {formatBaseUnits(BigInt(it.amount), MINT_DECIMALS)} → {short(it.merchant)}
                      </span>
                    )}
                    <ExplorerLink href={it.explorerUrl} label={it.signature ? short(it.signature) : short(it.receipt)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mt-8">
        <CardHeader>
          <CardTitle>About Payment History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-gray-400">
            <p>• Each payment creates a PaymentReceipt PDA on-chain with merchant, amount, time and request hash.</p>
            <p>• Receipts prevent replays: the same request hash cannot be paid twice.</p>
            <p>
              • A receipt may be closed after its request expired plus one day (rent goes back to the agent). The payment
              then stays visible here from its transaction log, as long as the RPC keeps that history.
            </p>
            <p>• Rejected attempts are failed transactions that reached the chain; simulated rejections are never sent.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
