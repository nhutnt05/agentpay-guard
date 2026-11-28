/**
 * Create policy form component
 * Builds and sends initialize_policy transaction
 */

'use client';

import { useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useRouter } from 'next/navigation';
import { PublicKey } from '@solana/web3.js';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { buildInitializePolicy } from '@/lib/wallet/transactions';
import { useSendTransaction } from '@/lib/wallet/useSendTransaction';
import { policyPda } from '@/lib/anchor/pda';
import { parseDecimalAmount } from '@/lib/solana/amounts';
import { MINT_DECIMALS } from '@/lib/anchor/constants';

export function CreatePolicyForm() {
  const { publicKey } = useWallet();
  const router = useRouter();
  const { send, loading, error } = useSendTransaction();

  const [agentAddress, setAgentAddress] = useState('');
  const [spendingLimit, setSpendingLimit] = useState('0.1');
  const [dailyLimit, setDailyLimit] = useState('1');
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!publicKey || !agentAddress) return;

    try {
      // Parse decimal amounts to base units
      const spendingLimitUnits = parseDecimalAmount(spendingLimit, MINT_DECIMALS);
      const dailyLimitUnits = parseDecimalAmount(dailyLimit, MINT_DECIMALS);

      // Generate random 32-byte policy ID
      const policyId = new Uint8Array(32);
      crypto.getRandomValues(policyId);

      // Parse agent address
      const agentPubkey = new PublicKey(agentAddress);

      // Build instruction
      const instruction = await buildInitializePolicy(
        publicKey,
        policyId,
        agentPubkey,
        spendingLimitUnits,
        dailyLimitUnits
      );

      // Send transaction
      const result = await send(instruction);

      if (result) {
        const [policyPDA] = policyPda(publicKey, policyId);
        setSuccess(result.signature);

        // Redirect after 2 seconds
        setTimeout(() => {
          router.push(`/policies/${policyPDA.toBase58()}`);
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to create policy:', err);
    }
  };

  if (!publicKey) {
    return (
      <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <Card>
          <CardContent className="text-center py-12">
            <h2 className="text-2xl font-bold text-white mb-4">
              Connect Your Wallet
            </h2>
            <p className="text-gray-400">
              Please connect your wallet to create a payment policy
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <SectionHeader
        title="Create Payment Policy"
        description="Set spending limits and initialize a secure vault for your AI agent"
      />

      <Card>
        <CardHeader>
          <CardTitle>Policy Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Owner Info */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Policy Owner
              </label>
              <div className="bg-gray-800 rounded-lg px-4 py-3 font-mono text-sm text-gray-300">
                {publicKey.toBase58()}
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Your wallet address will be the policy owner
              </p>
            </div>

            {/* Agent Address */}
            <div>
              <label
                htmlFor="agentAddress"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Agent Public Key
              </label>
              <Input
                id="agentAddress"
                type="text"
                placeholder="Enter agent wallet address..."
                value={agentAddress}
                onChange={(e) => setAgentAddress(e.target.value)}
                disabled={loading}
                required
              />
              <p className="mt-2 text-sm text-gray-500">
                The agent that will execute payments (get this from your server)
              </p>
            </div>

            {/* Spending Limit */}
            <div>
              <label
                htmlFor="spendingLimit"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Per-Transaction Limit (tokens)
              </label>
              <Input
                id="spendingLimit"
                type="number"
                step="0.000001"
                min="0.000001"
                value={spendingLimit}
                onChange={(e) => setSpendingLimit(e.target.value)}
                disabled={loading}
                required
              />
              <p className="mt-2 text-sm text-gray-500">
                Maximum amount the agent can spend per transaction
              </p>
            </div>

            {/* Daily Limit */}
            <div>
              <label
                htmlFor="dailyLimit"
                className="block text-sm font-medium text-gray-300 mb-2"
              >
                Daily Spending Limit (tokens)
              </label>
              <Input
                id="dailyLimit"
                type="number"
                step="0.000001"
                min="0.000001"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                disabled={loading}
                required
              />
              <p className="mt-2 text-sm text-gray-500">
                Maximum total amount the agent can spend per day
              </p>
            </div>

            {/* Error Message */}
            {error && (
              <div className="bg-red-500/10 border border-red-500 rounded-lg p-4">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Success Message */}
            {success && (
              <div className="bg-green-500/10 border border-green-500 rounded-lg p-4">
                <p className="text-green-400 text-sm">
                  Policy created successfully! Redirecting...
                </p>
                <p className="text-gray-400 text-xs mt-2 font-mono break-all">
                  Signature: {success}
                </p>
              </div>
            )}

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={loading || !!success || !agentAddress}
              className="w-full"
            >
              {loading ? 'Creating Policy...' : 'Create Policy'}
            </Button>

            {/* Info Box */}
            <div className="bg-blue-500/10 border border-blue-500 rounded-lg p-4">
              <p className="text-blue-400 text-sm">
                💡 <strong>Note:</strong> This transaction will create a policy account
                and a vault ATA on-chain. You&apos;ll need tokens for transaction fees.
              </p>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
