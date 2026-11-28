/**
 * Merchants manager component
 * Add/remove merchants from policy allowlist
 */

'use client';

import { useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import Link from 'next/link';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useSendTransaction } from '@/lib/wallet/useSendTransaction';
import { buildAddMerchant, buildRemoveMerchant } from '@/lib/wallet/transactions';

interface MerchantsManagerProps {
  policyAddress: string;
}

export function MerchantsManager({ policyAddress }: MerchantsManagerProps) {
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { send, loading, error } = useSendTransaction();

  const [merchantAddress, setMerchantAddress] = useState('');
  const [success, setSuccess] = useState<string | null>(null);

  const handleAddMerchant = async () => {
    if (!publicKey || !merchantAddress) return;

    try {
      const merchantPubkey = new PublicKey(merchantAddress);

      const instruction = buildAddMerchant(
        new PublicKey(policyAddress),
        publicKey,
        merchantPubkey
      );

      const result = await send(instruction);
      if (result) {
        setSuccess(`Merchant added! Signature: ${result.signature}`);
        setMerchantAddress('');
      }
    } catch (err) {
      console.error('Add merchant failed:', err);
    }
  };

  const handleRemoveMerchant = async () => {
    if (!publicKey || !merchantAddress) return;

    try {
      const merchantPubkey = new PublicKey(merchantAddress);

      const instruction = buildRemoveMerchant(
        new PublicKey(policyAddress),
        publicKey,
        merchantPubkey
      );

      const result = await send(instruction);
      if (result) {
        setSuccess(`Merchant removed! Signature: ${result.signature}`);
        setMerchantAddress('');
      }
    } catch (err) {
      console.error('Remove merchant failed:', err);
    }
  };

  if (!publicKey) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Card>
          <CardContent className="text-center py-12">
            <h2 className="text-2xl font-bold text-white mb-4">
              Connect Your Wallet
            </h2>
            <p className="text-gray-400">
              Please connect your wallet to manage merchants
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <SectionHeader
          title="Manage Merchants"
          description="Add or remove merchants from the allowlist"
        />
        <div className="mt-4">
          <Link href={`/policies/${policyAddress}`}>
            <Button>← Back to Policy</Button>
          </Link>
        </div>
      </div>

      {/* Success Message */}
      {success && (
        <div className="bg-green-500/10 border border-green-500 rounded-lg p-4 mb-8">
          <p className="text-green-400 text-sm">{success}</p>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-red-500/10 border border-red-500 rounded-lg p-4 mb-8">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* Add/Remove Form */}
      <Card>
        <CardHeader>
          <CardTitle>Merchant Address</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Merchant Public Key
            </label>
            <Input
              type="text"
              placeholder="Enter merchant wallet address..."
              value={merchantAddress}
              onChange={(e) => setMerchantAddress(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Button
              onClick={handleAddMerchant}
              disabled={loading || !merchantAddress}
              className="w-full"
            >
              {loading ? 'Processing...' : 'Add Merchant'}
            </Button>
            <Button
              onClick={handleRemoveMerchant}
              disabled={loading || !merchantAddress}
              className="w-full bg-red-600 hover:bg-red-700"
            >
              {loading ? 'Processing...' : 'Remove Merchant'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Info */}
      <Card className="mt-8">
        <CardHeader>
          <CardTitle>About Merchant Allowlist</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3 text-sm text-gray-400">
            <p>
              • <strong>Add Merchant:</strong> Allows the agent to send payments to this address
            </p>
            <p>
              • <strong>Remove Merchant:</strong> Blocks the agent from sending to this address
            </p>
            <p>
              • The allowlist is stored on-chain in MerchantAllowlist PDAs
            </p>
            <p>
              • Only the policy owner can modify the allowlist
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
