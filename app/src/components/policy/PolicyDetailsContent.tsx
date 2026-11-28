"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { ExplorerLink, short } from "@/components/ui/ExplorerLink";
import { Input } from "@/components/ui/Input";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { StatCard } from "@/components/ui/StatCard";
import { createApiClient, type AnyData } from "@/lib/client/api";
import { getProgram } from "@/lib/anchor/program";
import { PROGRAM_ID } from "@/lib/anchor/constants";
import { formatBaseUnits, parseDecimalAmount } from "@/lib/solana/amounts";
import { useSendTransaction } from "@/lib/wallet/useSendTransaction";
import {
  buildPausePolicy,
  buildResumePolicy,
  buildUpdatePolicy,
  buildWithdraw,
} from "@/lib/wallet/transactions";
import { AGENT_IS_MERCHANT_WARNING, agentIsAllowlistedMerchant } from "@/lib/policy/warnings";

const api = createApiClient();

interface PolicyDetailsContentProps {
  policyId: string;
}

export function PolicyDetailsContent({ policyId }: PolicyDetailsContentProps) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const [policy, setPolicy] = useState<AnyData | null>(null);
  const [merchants, setMerchants] = useState<AnyData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Withdraw form
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const withdrawTx = useSendTransaction();

  // Update form
  const [newAgent, setNewAgent] = useState("");
  const [newMaxPerTx, setNewMaxPerTx] = useState("");
  const [newDailyLimit, setNewDailyLimit] = useState("");
  const updateTx = useSendTransaction();

  const pauseTx = useSendTransaction();
  const resumeTx = useSendTransaction();

  async function loadPolicy() {
    setLoading(true);
    setError(null);
    try {
      const [policyRes, merchantsRes] = await Promise.all([
        api.policy(policyId),
        api.merchants(policyId),
      ]);

      if (!policyRes.ok) {
        setError(policyRes.error?.message || "Failed to load policy");
        setPolicy(null);
        return;
      }

      setPolicy(policyRes.data || null);
      setMerchants((merchantsRes.data?.merchants as AnyData[]) || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load policy");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPolicy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId]);

  // Reload after successful transaction
  useEffect(() => {
    if (pauseTx.signature || resumeTx.signature || withdrawTx.signature || updateTx.signature) {
      setTimeout(() => void loadPolicy(), 2000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pauseTx.signature, resumeTx.signature, withdrawTx.signature, updateTx.signature]);

  if (loading) {
    return <div className="text-sm text-zinc-400">Loading policy...</div>;
  }

  if (error || !policy) {
    return (
      <Card variant="danger">
        <CardContent className="py-4">
          <p className="text-red-400">{error || "Policy not found"}</p>
          <Link href="/dashboard" className="mt-4 inline-block">
            <Button variant="secondary" size="sm">
              Back to Dashboard
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const decimals = policy.decimals ?? 6;
  const isOwner = connected && publicKey?.toBase58() === policy.owner;
  const hasAgentWarning = agentIsAllowlistedMerchant(
    policy.agent,
    merchants.map((m) => m.merchant)
  );

  async function handlePause() {
    if (!publicKey || !connected || !policy) return;

    try {
      const policyIdBytes = Buffer.from(policy.policyIdHex, "hex");
      const program = getProgram(connection, { publicKey } as any);

      const tx = await buildPausePolicy({
        program,
        owner: publicKey,
        policyId: new Uint8Array(policyIdBytes),
      });

      await pauseTx.sendTransaction(tx);
    } catch (err) {
      console.error("Failed to pause:", err);
    }
  }

  async function handleResume() {
    if (!publicKey || !connected || !policy) return;

    try {
      const policyIdBytes = Buffer.from(policy.policyIdHex, "hex");
      const program = getProgram(connection, { publicKey } as any);

      const tx = await buildResumePolicy({
        program,
        owner: publicKey,
        policyId: new Uint8Array(policyIdBytes),
      });

      await resumeTx.sendTransaction(tx);
    } catch (err) {
      console.error("Failed to resume:", err);
    }
  }

  async function handleWithdraw(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!publicKey || !connected || !withdrawAmount || !policy) return;

    try {
      const policyIdBytes = Buffer.from(policy.policyIdHex, "hex");
      const amount = parseDecimalAmount(withdrawAmount, decimals);
      const program = getProgram(connection, { publicKey } as any);

      const tx = await buildWithdraw({
        program,
        owner: publicKey,
        policyId: new Uint8Array(policyIdBytes),
        mint: new PublicKey(policy.mint),
        amount,
      });

      const sig = await withdrawTx.sendTransaction(tx);
      if (sig) {
        setWithdrawAmount("");
      }
    } catch (err) {
      console.error("Failed to withdraw:", err);
    }
  }

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!publicKey || !connected || !policy) return;
    if (!newAgent && !newMaxPerTx && !newDailyLimit) return;

    try {
      const policyIdBytes = Buffer.from(policy.policyIdHex, "hex");
      const program = getProgram(connection, { publicKey } as any);

      const tx = await buildUpdatePolicy({
        program,
        owner: publicKey,
        policyId: new Uint8Array(policyIdBytes),
        newAgent: newAgent ? new PublicKey(newAgent) : undefined,
        newMaxPerTx: newMaxPerTx ? parseDecimalAmount(newMaxPerTx, decimals) : undefined,
        newDailyLimit: newDailyLimit ? parseDecimalAmount(newDailyLimit, decimals) : undefined,
      });

      const sig = await updateTx.sendTransaction(tx);
      if (sig) {
        setNewAgent("");
        setNewMaxPerTx("");
        setNewDailyLimit("");
      }
    } catch (err) {
      console.error("Failed to update:", err);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-zinc-100">Policy Details</h1>
          <p className="mt-1 font-mono text-sm text-zinc-400">{policy.address}</p>
        </div>
        <div className="flex gap-2">
          {!connected && <WalletMultiButton />}
          <Link href="/dashboard">
            <Button variant="ghost" size="sm">
              Back
            </Button>
          </Link>
        </div>
      </div>

      {/* Warning if agent is allowlisted merchant */}
      {hasAgentWarning && (
        <Card variant="warning">
          <CardContent className="py-3 text-sm text-amber-200">
            ⚠ {AGENT_IS_MERCHANT_WARNING}
          </CardContent>
        </Card>
      )}

      {/* Policy Status */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Vault Balance"
          value={formatBaseUnits(BigInt(policy.vaultBalance || "0"), decimals)}
          subtitle={`${policy.vaultBalance || "0"} base units`}
        />
        <StatCard
          label="Spent Today"
          value={
            policy.derived?.effectiveSpentToday
              ? formatBaseUnits(BigInt(policy.derived.effectiveSpentToday), decimals)
              : "—"
          }
          subtitle={`/ ${formatBaseUnits(BigInt(policy.dailyLimit), decimals)} daily limit`}
        />
        <StatCard
          label="Max Per Transaction"
          value={formatBaseUnits(BigInt(policy.maxPerTx), decimals)}
        />
        <StatCard
          label="Status"
          value={
            <Badge tone={policy.isPaused ? "warning" : "success"}>
              {policy.isPaused ? "Paused" : "Active"}
            </Badge>
          }
        />
      </div>

      {/* Policy Info */}
      <Card>
        <CardHeader>
          <CardTitle>Policy Information</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <div className="text-zinc-500">Owner</div>
            <div className="font-mono text-zinc-100">
              <ExplorerLink
                href={`https://explorer.solana.com/address/${policy.owner}?cluster=devnet`}
                label={short(policy.owner)}
              />
              {isOwner && (
                <Badge tone="info" className="ml-2">
                  You
                </Badge>
              )}
            </div>
          </div>
          <div>
            <div className="text-zinc-500">Agent</div>
            <div className="font-mono text-zinc-100">
              <ExplorerLink
                href={`https://explorer.solana.com/address/${policy.agent}?cluster=devnet`}
                label={short(policy.agent)}
              />
            </div>
          </div>
          <div>
            <div className="text-zinc-500">Mint</div>
            <div className="font-mono text-zinc-100">
              <ExplorerLink
                href={`https://explorer.solana.com/address/${policy.mint}?cluster=devnet`}
                label={short(policy.mint)}
              />
            </div>
          </div>
          <div>
            <div className="text-zinc-500">Vault</div>
            <div className="font-mono text-zinc-100">
              <ExplorerLink
                href={`https://explorer.solana.com/address/${policy.vault}?cluster=devnet`}
                label={short(policy.vault)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Owner Actions */}
      {isOwner && (
        <>
          {/* Pause/Resume */}
          <Card>
            <CardHeader>
              <CardTitle>Emergency Controls</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-zinc-400">
                Pause the policy to immediately block all agent payments. Resume to restore normal operation.
              </p>
              <div className="flex gap-3">
                {policy.isPaused ? (
                  <Button
                    variant="primary"
                    onClick={handleResume}
                    disabled={resumeTx.loading}
                  >
                    {resumeTx.loading ? "Resuming..." : "Resume Policy"}
                  </Button>
                ) : (
                  <Button
                    variant="danger"
                    onClick={handlePause}
                    disabled={pauseTx.loading}
                  >
                    {pauseTx.loading ? "Pausing..." : "Pause Policy"}
                  </Button>
                )}
              </div>
              {pauseTx.signature && (
                <p className="text-sm text-emerald-400">
                  Paused! Tx:{" "}
                  <ExplorerLink
                    href={`https://explorer.solana.com/tx/${pauseTx.signature}?cluster=devnet`}
                    label={short(pauseTx.signature)}
                  />
                </p>
              )}
              {resumeTx.signature && (
                <p className="text-sm text-emerald-400">
                  Resumed! Tx:{" "}
                  <ExplorerLink
                    href={`https://explorer.solana.com/tx/${resumeTx.signature}?cluster=devnet`}
                    label={short(resumeTx.signature)}
                  />
                </p>
              )}
              {(pauseTx.error || resumeTx.error) && (
                <p className="text-sm text-red-400">{pauseTx.error || resumeTx.error}</p>
              )}
            </CardContent>
          </Card>

          {/* Withdraw */}
          <Card>
            <CardHeader>
              <CardTitle>Withdraw Funds</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleWithdraw} className="space-y-4">
                <Input
                  label="Amount"
                  type="text"
                  placeholder="0.00"
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  disabled={withdrawTx.loading}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={!withdrawAmount || withdrawTx.loading}
                >
                  {withdrawTx.loading ? "Withdrawing..." : "Withdraw to Owner"}
                </Button>
                {withdrawTx.signature && (
                  <p className="text-sm text-emerald-400">
                    Withdrawn! Tx:{" "}
                    <ExplorerLink
                      href={`https://explorer.solana.com/tx/${withdrawTx.signature}?cluster=devnet`}
                      label={short(withdrawTx.signature)}
                    />
                  </p>
                )}
                {withdrawTx.error && <p className="text-sm text-red-400">{withdrawTx.error}</p>}
              </form>
            </CardContent>
          </Card>

          {/* Update Policy */}
          <Card>
            <CardHeader>
              <CardTitle>Update Policy</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdate} className="space-y-4">
                <Input
                  label="New Agent (optional)"
                  placeholder="Leave blank to keep current"
                  value={newAgent}
                  onChange={(e) => setNewAgent(e.target.value)}
                  disabled={updateTx.loading}
                  className="font-mono"
                />
                <Input
                  label="New Max Per Tx (optional)"
                  placeholder="Leave blank to keep current"
                  value={newMaxPerTx}
                  onChange={(e) => setNewMaxPerTx(e.target.value)}
                  disabled={updateTx.loading}
                />
                <Input
                  label="New Daily Limit (optional)"
                  placeholder="Leave blank to keep current"
                  value={newDailyLimit}
                  onChange={(e) => setNewDailyLimit(e.target.value)}
                  disabled={updateTx.loading}
                />
                <Button
                  type="submit"
                  variant="secondary"
                  disabled={(!newAgent && !newMaxPerTx && !newDailyLimit) || updateTx.loading}
                >
                  {updateTx.loading ? "Updating..." : "Update Policy"}
                </Button>
                {updateTx.signature && (
                  <p className="text-sm text-emerald-400">
                    Updated! Tx:{" "}
                    <ExplorerLink
                      href={`https://explorer.solana.com/tx/${updateTx.signature}?cluster=devnet`}
                      label={short(updateTx.signature)}
                    />
                  </p>
                )}
                {updateTx.error && <p className="text-sm text-red-400">{updateTx.error}</p>}
              </form>
            </CardContent>
          </Card>
        </>
      )}

      {!isOwner && connected && (
        <Card variant="warning">
          <CardContent className="py-4 text-center text-sm text-amber-200">
            You are not the owner of this policy. Only the owner can perform management actions.
          </CardContent>
        </Card>
      )}

      {/* Merchants Section */}
      <Card>
        <CardHeader>
          <SectionHeader
            title="Allowlisted Merchants"
            description={`${merchants.length} merchant${merchants.length !== 1 ? "s" : ""} approved`}
          />
        </CardHeader>
        <CardContent>
          {merchants.length === 0 ? (
            <p className="text-center text-sm text-zinc-500">No merchants allowlisted yet</p>
          ) : (
            <div className="space-y-2">
              {merchants.map((m) => (
                <div
                  key={m.merchant}
                  className="flex items-center justify-between rounded border border-zinc-800 bg-zinc-900/50 p-3"
                >
                  <div className="font-mono text-sm">
                    <ExplorerLink
                      href={`https://explorer.solana.com/address/${m.merchant}?cluster=devnet`}
                      label={m.merchant}
                    />
                  </div>
                  <Badge tone="success">Allowed</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
