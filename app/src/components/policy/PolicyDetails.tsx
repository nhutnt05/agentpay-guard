/**
 * Policy details component
 * Shows policy info, controls (pause/resume/update/withdraw)
 */

'use client';

import { useCallback, useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Badge } from '@/components/ui/Badge';
import { ExplorerLink } from '@/components/ui/ExplorerLink';
import { formatBaseUnits, parseDecimalAmount } from '@/lib/solana/amounts';
import { MINT_DECIMALS } from '@/lib/anchor/constants';
import { getReadonlyProgram } from '@/lib/anchor/program';
import { useSendTransaction } from '@/lib/wallet/useSendTransaction';
import {
  pausePolicyIx,
  resumePolicyIx,
  updateLimitsIx,
  withdrawVaultIx,
} from '@/lib/wallet/transactions';

interface PolicyDetailsProps {
  policyAddress: string;
}

interface PolicyData {
  owner: string;
  paused: boolean;
  spendingLimit: bigint;
  dailyLimit: bigint;
  vaultBalance: bigint;
  totalSpent: bigint;
  vault: string;
}

export function PolicyDetails({ policyAddress }: PolicyDetailsProps) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { send, loading: txLoading, error: txError } = useSendTransaction();

  const [policy, setPolicy] = useState<PolicyData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Form states
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [newSpendingLimit, setNewSpendingLimit] = useState('');
  const [newDailyLimit, setNewDailyLimit] = useState('');

  // Decode with the IDL coder (discriminator + exact `AgentPolicy` layout). The earlier
  // hand-written decoder used an outdated layout and showed wrong pause state and limits.
  const loadPolicy = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const policyPubkey = new PublicKey(policyAddress);
      const program = getReadonlyProgram(connection, policyPubkey);
      const account = await program.account.agentPolicy.fetchNullable(policyPubkey);
      if (!account) {
        throw new Error('Policy account not found');
      }

      // The vault address is stored in the policy (works for any mint / token program).
      const vaultInfo = await connection.getTokenAccountBalance(account.vault);
      const maxPerTx = BigInt(account.maxPerTx.toString());
      const dailyLimit = BigInt(account.dailyLimit.toString());

      setPolicy({
        owner: account.owner.toBase58(),
        paused: account.isPaused,
        spendingLimit: maxPerTx,
        dailyLimit,
        vaultBalance: BigInt(vaultInfo.value.amount),
        totalSpent: BigInt(account.spentToday.toString()),
        vault: account.vault.toBase58(),
      });

      // Set default form values
      setNewSpendingLimit(formatBaseUnits(maxPerTx, MINT_DECIMALS));
      setNewDailyLimit(formatBaseUnits(dailyLimit, MINT_DECIMALS));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load policy';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [connection, policyAddress]);

  useEffect(() => {
    // Data fetch on mount / policy change; state is set after the await, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPolicy();
  }, [loadPolicy]);

  const handlePause = async () => {
    if (!publicKey || !policy) return;

    try {
      const instruction = await pausePolicyIx(
        new PublicKey(policyAddress),
        publicKey
      );

      const result = await send(instruction);
      if (result) {
        setSuccess(`Policy paused! Signature: ${result.signature}`);
        await loadPolicy();
      }
    } catch (err) {
      console.error('Pause failed:', err);
    }
  };

  const handleResume = async () => {
    if (!publicKey || !policy) return;

    try {
      const instruction = await resumePolicyIx(
        new PublicKey(policyAddress),
        publicKey
      );

      const result = await send(instruction);
      if (result) {
        setSuccess(`Policy resumed! Signature: ${result.signature}`);
        await loadPolicy();
      }
    } catch (err) {
      console.error('Resume failed:', err);
    }
  };

  const handleUpdate = async () => {
    if (!publicKey || !newSpendingLimit || !newDailyLimit) return;

    try {
      const spendingLimit = parseDecimalAmount(newSpendingLimit, MINT_DECIMALS);
      const dailyLimit = parseDecimalAmount(newDailyLimit, MINT_DECIMALS);

      const instruction = await updateLimitsIx(
        new PublicKey(policyAddress),
        publicKey,
        spendingLimit,
        dailyLimit
      );

      const result = await send(instruction);
      if (result) {
        setSuccess(`Policy updated! Signature: ${result.signature}`);
        await loadPolicy();
      }
    } catch (err) {
      console.error('Update failed:', err);
    }
  };

  const handleWithdraw = async () => {
    if (!publicKey || !withdrawAmount) return;

    try {
      const amount = parseDecimalAmount(withdrawAmount, MINT_DECIMALS);

      const instruction = await withdrawVaultIx(
        new PublicKey(policyAddress),
        publicKey,
        amount
      );

      const result = await send(instruction);
      if (result) {
        setSuccess(`Withdrawal successful! Signature: ${result.signature}`);
        setWithdrawAmount('');
        await loadPolicy();
      }
    } catch (err) {
      console.error('Withdraw failed:', err);
    }
  };

  if (loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="text-center text-gray-400">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-[#14F195] mx-auto mb-4"></div>
          Loading policy...
        </div>
      </div>
    );
  }

  if (error || !policy) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Card>
          <CardContent className="text-center py-12">
            <h2 className="text-2xl font-bold text-white mb-4">Error</h2>
            <p className="text-red-400">{error || 'Policy not found'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isOwner = publicKey && policy.owner === publicKey.toBase58();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <SectionHeader title="Policy Details" description={policyAddress} />
        </div>
        <Badge tone={policy.paused ? 'danger' : 'success'}>
          {policy.paused ? 'Paused' : 'Active'}
        </Badge>
      </div>

      {/* Not Owner Warning */}
      {!isOwner && (
        <div className="bg-yellow-500/10 border border-yellow-500 rounded-lg p-4 mb-8">
          <p className="text-yellow-400 text-sm">
            ⚠️ You are not the owner of this policy. Management actions are disabled.
          </p>
        </div>
      )}

      {/* Success Message */}
      {success && (
        <div className="bg-green-500/10 border border-green-500 rounded-lg p-4 mb-8">
          <p className="text-green-400 text-sm">{success}</p>
        </div>
      )}

      {/* Transaction Error */}
      {txError && (
        <div className="bg-red-500/10 border border-red-500 rounded-lg p-4 mb-8">
          <p className="text-red-400 text-sm">{txError}</p>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-gray-400 mb-1">Vault Balance</div>
            <div className="text-2xl font-bold text-[#14F195]">
              {formatBaseUnits(policy.vaultBalance, MINT_DECIMALS)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-gray-400 mb-1">Total Spent</div>
            <div className="text-2xl font-bold text-white">
              {formatBaseUnits(policy.totalSpent, MINT_DECIMALS)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-gray-400 mb-1">Daily Limit</div>
            <div className="text-2xl font-bold text-white">
              {formatBaseUnits(policy.dailyLimit, MINT_DECIMALS)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="text-sm text-gray-400 mb-1">Per-Tx Limit</div>
            <div className="text-2xl font-bold text-white">
              {formatBaseUnits(policy.spendingLimit, MINT_DECIMALS)}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Policy Controls */}
        <Card>
          <CardHeader>
            <CardTitle>Policy Controls</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {policy.paused ? (
              <Button
                onClick={handleResume}
                disabled={!isOwner || txLoading}
                className="w-full bg-green-600 hover:bg-green-700"
              >
                {txLoading ? 'Processing...' : 'Resume Policy'}
              </Button>
            ) : (
              <Button
                onClick={handlePause}
                disabled={!isOwner || txLoading}
                className="w-full bg-red-600 hover:bg-red-700"
              >
                {txLoading ? 'Processing...' : 'Pause Policy'}
              </Button>
            )}

            <div className="border-t border-gray-700 pt-4">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Update Limits</h4>
              <div className="space-y-3">
                <Input
                  type="number"
                  step="0.000001"
                  placeholder="Per-Tx Limit"
                  value={newSpendingLimit}
                  onChange={(e) => setNewSpendingLimit(e.target.value)}
                  disabled={!isOwner || txLoading}
                />
                <Input
                  type="number"
                  step="0.000001"
                  placeholder="Daily Limit"
                  value={newDailyLimit}
                  onChange={(e) => setNewDailyLimit(e.target.value)}
                  disabled={!isOwner || txLoading}
                />
                <Button
                  onClick={handleUpdate}
                  disabled={!isOwner || txLoading || !newSpendingLimit || !newDailyLimit}
                  className="w-full"
                >
                  {txLoading ? 'Processing...' : 'Update Limits'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Withdraw */}
        <Card>
          <CardHeader>
            <CardTitle>Withdraw Funds</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-2">
                Available: {formatBaseUnits(policy.vaultBalance, MINT_DECIMALS)}
              </label>
              <Input
                type="number"
                step="0.000001"
                placeholder="Amount"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                disabled={!isOwner || txLoading}
              />
            </div>
            <Button
              onClick={handleWithdraw}
              disabled={!isOwner || txLoading || !withdrawAmount}
              className="w-full"
            >
              {txLoading ? 'Processing...' : 'Withdraw'}
            </Button>
          </CardContent>
        </Card>

        {/* Quick Links */}
        <Card>
          <CardHeader>
            <CardTitle>Manage</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href={`/policies/${policyAddress}/merchants`}>
              <Button className="w-full" disabled={!isOwner}>
                Manage Merchants
              </Button>
            </Link>
            <Link href={`/policies/${policyAddress}/payments`}>
              <Button className="w-full">View Payment History</Button>
            </Link>
          </CardContent>
        </Card>

        {/* Policy Info */}
        <Card>
          <CardHeader>
            <CardTitle>Policy Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Owner</label>
              <ExplorerLink href={`https://explorer.solana.com/address/${policy.owner}?cluster=devnet`} label={policy.owner} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Vault</label>
              <ExplorerLink href={`https://explorer.solana.com/address/${policy.vault}?cluster=devnet`} label={policy.vault} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
