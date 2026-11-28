/**
 * Policy details component
 * Shows policy info, controls (pause/resume/update/withdraw)
 */

'use client';

import { useEffect, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Badge } from '@/components/ui/Badge';
import { ExplorerLink } from '@/components/ui/ExplorerLink';
import { getBrowserProgram } from '@/lib/wallet/program';
import { formatBaseUnits, parseDecimalAmount } from '@/lib/solana/amounts';
import { MINT_DECIMALS, MINT } from '@/lib/anchor/constants';
import { vaultAddress } from '@/lib/anchor/pda';
import { useSendTransaction } from '@/lib/wallet/useSendTransaction';
import {
  buildPausePolicy,
  buildResumePolicy,
  buildUpdatePolicy,
  buildWithdraw,
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

  useEffect(() => {
    loadPolicy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyAddress]);

  const loadPolicy = async () => {
    setLoading(true);
    setError(null);

    try {
      const program = getBrowserProgram(connection);
      const policyPubkey = new PublicKey(policyAddress);

      // Fetch policy account - using correct account name from IDL
      const policyAccount = await program.account.agentPolicy.fetch(policyPubkey);

      // Fetch vault balance
      const vaultPDA = vaultAddress(policyPubkey, MINT);
      const vaultInfo = await connection.getTokenAccountBalance(vaultPDA);
      const vaultBalance = BigInt(vaultInfo.value.amount);

      setPolicy({
        owner: policyAccount.owner.toBase58(),
        paused: policyAccount.paused,
        spendingLimit: policyAccount.maxPerTx.toBigInt(),
        dailyLimit: policyAccount.dailyLimit.toBigInt(),
        vaultBalance,
        totalSpent: policyAccount.totalSpent.toBigInt(),
        vault: vaultPDA.toBase58(),
      });

      // Set default form values
      setNewSpendingLimit(formatBaseUnits(policyAccount.maxPerTx.toBigInt(), MINT_DECIMALS));
      setNewDailyLimit(formatBaseUnits(policyAccount.dailyLimit.toBigInt(), MINT_DECIMALS));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load policy';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const handlePause = async () => {
    if (!publicKey || !policy) return;

    try {
      const program = getBrowserProgram(connection);
      const instruction = await buildPausePolicy({
        program,
        policyAddress: new PublicKey(policyAddress),
        owner: publicKey,
      });

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
      const program = getBrowserProgram(connection);
      const instruction = await buildResumePolicy({
        program,
        policyAddress: new PublicKey(policyAddress),
        owner: publicKey,
      });

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
      const program = getBrowserProgram(connection);
      const spendingLimit = parseDecimalAmount(newSpendingLimit, MINT_DECIMALS);
      const dailyLimit = parseDecimalAmount(newDailyLimit, MINT_DECIMALS);

      const instruction = await buildUpdatePolicy(
        program,
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
      const program = getBrowserProgram(connection);
      const amount = parseDecimalAmount(withdrawAmount, MINT_DECIMALS);

      const instruction = await buildWithdraw(
        program,
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
