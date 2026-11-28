"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Address } from "@/components/ui/Address";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconBot, IconPause, IconPlay, IconRefresh, IconSettings, IconStore, IconVault } from "@/components/ui/icons";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/SectionHeader";
import { LoadingBlock } from "@/components/ui/Spinner";
import { Meter, StatCard } from "@/components/ui/StatCard";
import { getProgram, readOnlyWallet } from "@/lib/anchor/program";
import { usePolicyData } from "@/lib/client/usePolicyData";
import { reasonLabel } from "@/lib/demo/labels";
import { AGENT_IS_MERCHANT_WARNING, agentIsAllowlistedMerchant, newAgentWarning } from "@/lib/policy/warnings";
import { formatBaseUnits, parseDecimalAmount } from "@/lib/solana/amounts";
import { buildPausePolicy, buildResumePolicy, buildUpdatePolicy, buildWithdraw } from "@/lib/wallet/transactions";
import { useSendTransaction } from "@/lib/wallet/useSendTransaction";
import { isBase58Address, PolicyTabs, short, TxFeedback } from "./shared";

function parseAmount(value: string, decimals: number): bigint | null {
  if (!value.trim()) return null;
  try {
    const v = parseDecimalAmount(value.trim(), decimals);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export function PolicyDetails({ policyAddress }: { policyAddress: string }) {
  const { connection } = useConnection();
  const { publicKey, connected } = useWallet();
  const { policy, merchants, loading, refreshing, error, reload } = usePolicyData(policyAddress);

  const pauseTx = useSendTransaction();
  const withdrawTx = useSendTransaction();
  const updateTx = useSendTransaction();

  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [newMaxPerTx, setNewMaxPerTx] = useState("");
  const [newDailyLimit, setNewDailyLimit] = useState("");
  const [newAgent, setNewAgent] = useState("");

  // Reload on-chain state shortly after any confirmed owner transaction.
  const lastSig = pauseTx.signature ?? withdrawTx.signature ?? updateTx.signature;
  useEffect(() => {
    if (!lastSig) return;
    const t = setTimeout(() => void reload(), 1500);
    return () => clearTimeout(t);
  }, [lastSig, reload]);

  if (loading) return <LoadingBlock label="Reading policy from chain…" />;

  if (error || !policy) {
    return (
      <Card className="mx-auto max-w-xl">
        <EmptyState
          icon={<IconVault size={24} />}
          title="Policy not found"
          description={error ?? "There is no AgentPay Guard policy at this address on devnet."}
          action={
            <>
              <Button variant="secondary" onClick={() => void reload("initial")}>
                Try again
              </Button>
              <ButtonLink href="/policies">Back to policies</ButtonLink>
            </>
          }
        />
      </Card>
    );
  }

  const decimals: number = policy.decimals ?? 6;
  const fmt = (units: string | bigint | null | undefined) => (units === null || units === undefined ? "—" : formatBaseUnits(BigInt(units), decimals));
  const vaultBalance = BigInt(policy.vaultBalance ?? "0");
  const dailyLimit = BigInt(policy.dailyLimit);
  const maxPerTx = BigInt(policy.maxPerTx);
  const spentToday = BigInt(policy.derived?.effectiveSpentToday ?? "0");
  const isOwner = connected && publicKey?.toBase58() === policy.owner;
  const merchantList = merchants.map((m) => m.merchant as string);
  const agentIsMerchant = agentIsAllowlistedMerchant(policy.agent, merchantList);

  // Withdraw validation
  const withdrawUnits = parseAmount(withdrawAmount, decimals);
  const withdrawError =
    withdrawAmount.trim() === "" ? null : !withdrawUnits ? "Enter an amount greater than 0." : withdrawUnits > vaultBalance ? "More than the vault holds." : null;

  // Update validation (validate the resulting limits, like the program does)
  const nextMax = newMaxPerTx.trim() ? parseAmount(newMaxPerTx, decimals) : maxPerTx;
  const nextDaily = newDailyLimit.trim() ? parseAmount(newDailyLimit, decimals) : dailyLimit;
  const agentInput = newAgent.trim();
  const updateErrors = {
    max: newMaxPerTx.trim() && !nextMax ? "Enter an amount greater than 0." : nextMax && nextDaily && nextMax > nextDaily ? "Cannot exceed the daily limit." : null,
    daily: newDailyLimit.trim() && !nextDaily ? "Enter an amount greater than 0." : null,
    agent:
      agentInput && !isBase58Address(agentInput)
        ? "Not a valid Solana address."
        : agentInput && agentInput === policy.owner
          ? "The agent must differ from the owner."
          : null,
  };
  const agentWarn = agentInput && isBase58Address(agentInput) ? newAgentWarning(agentInput, merchantList) : null;
  const hasUpdate = Boolean(newMaxPerTx.trim() || newDailyLimit.trim() || agentInput);
  const updateValid = hasUpdate && !updateErrors.max && !updateErrors.daily && !updateErrors.agent;

  const policyIdBytes = () => new Uint8Array(Buffer.from(policy.policyIdHex, "hex"));
  const program = () => getProgram(connection, readOnlyWallet(publicKey!));

  async function togglePause() {
    if (!publicKey || !isOwner) return;
    try {
      const build = policy!.isPaused ? buildResumePolicy : buildPausePolicy;
      await pauseTx.sendTransaction(await build({ program: program(), owner: publicKey, policyId: policyIdBytes() }));
    } catch (e) {
      console.error("pause/resume failed:", e);
    }
  }

  async function withdraw(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey || !isOwner || !withdrawUnits || withdrawError) return;
    try {
      const tx = await buildWithdraw({
        program: program(),
        owner: publicKey,
        policyId: policyIdBytes(),
        mint: new PublicKey(policy!.mint),
        amount: withdrawUnits,
      });
      if (await withdrawTx.sendTransaction(tx)) setWithdrawAmount("");
    } catch (err) {
      console.error("withdraw failed:", err);
    }
  }

  async function update(e: React.FormEvent) {
    e.preventDefault();
    if (!publicKey || !isOwner || !updateValid) return;
    try {
      const tx = await buildUpdatePolicy({
        program: program(),
        owner: publicKey,
        policyId: policyIdBytes(),
        newAgent: agentInput ? new PublicKey(agentInput) : undefined,
        newMaxPerTx: newMaxPerTx.trim() ? (nextMax ?? undefined) : undefined,
        newDailyLimit: newDailyLimit.trim() ? (nextDaily ?? undefined) : undefined,
      });
      if (await updateTx.sendTransaction(tx)) {
        setNewMaxPerTx("");
        setNewDailyLimit("");
        setNewAgent("");
      }
    } catch (err) {
      console.error("update failed:", err);
    }
  }

  const ownerDisabledHint = !connected ? "Connect the owner wallet to use this." : !isOwner ? "Only the policy owner can do this." : undefined;

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Policies", href: "/policies" }, { label: short(policy.address) }]}
        eyebrow={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={policy.isPaused ? "warning" : "success"} dot>
              {policy.isPaused ? "Paused — payments blocked" : "Active"}
            </Badge>
            {isOwner && <Badge tone="info">You own this policy</Badge>}
          </div>
        }
        title={<span className="font-mono">{short(policy.address)}</span>}
        description={<Address value={policy.address} full className="mt-1" />}
        actions={
          <>
            <Button variant="ghost" onClick={() => void reload()} loading={refreshing} icon={<IconRefresh size={16} />}>
              Refresh
            </Button>
            <ButtonLink href={`/agent?policy=${policy.address}`} variant="secondary" icon={<IconBot size={16} />}>
              Test with agent
            </ButtonLink>
          </>
        }
      />
      <PolicyTabs policyId={policy.address} />

      <div className="space-y-4">
        {agentIsMerchant && <Alert tone="warning" title="Configuration warning">{AGENT_IS_MERCHANT_WARNING}</Alert>}
        {!connected && (
          <Alert tone="info" title="Read-only view">
            Connect the owner wallet to pause, withdraw or change limits. Anyone can read a policy — it is public on-chain data.
          </Alert>
        )}
        {connected && !isOwner && (
          <Alert tone="info" title="You are not the owner">
            The connected wallet is not this policy&apos;s owner, so management actions are disabled.
          </Alert>
        )}
        {policy.servedByThisAgent === false && (
          <Alert tone="info" title="This server's agent does not pay for this policy">
            {reasonLabel(policy.accessReason) ?? policy.accessReason}. Payments through this app&apos;s agent will be refused before reaching the chain.
          </Alert>
        )}
      </div>

      {/* Stats */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Policy status">
        <StatCard label="Vault balance" value={fmt(vaultBalance)} accent icon={<IconVault size={16} />} subtitle="Available to the agent within limits" />
        <StatCard label="Spent today (UTC)" value={fmt(spentToday)} subtitle={`of ${fmt(dailyLimit)} daily limit`}>
          <Meter value={spentToday} max={dailyLimit} label="Spent today vs daily limit" />
        </StatCard>
        <StatCard label="Max per payment" value={fmt(maxPerTx)} subtitle="Larger payments are rejected" />
        <StatCard
          label="Status"
          value={policy.isPaused ? <span className="text-warning">Paused</span> : <span className="text-brand">Active</span>}
          subtitle={policy.createdAt ? `Created ${new Date(policy.createdAt * 1000).toLocaleDateString()}` : undefined}
        />
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
        {/* Left column */}
        <div className="space-y-6">
          <Card>
            <CardHeader title="Accounts" description="Everything here is read from chain on each load." />
            <dl className="divide-y divide-line">
              {[
                ["Owner", policy.owner, "Signs management actions"],
                ["Agent", policy.agent, "Signs payments"],
                ["Vault", policy.vault, "Holds the funds (program-controlled)"],
                ["Token mint", policy.mint, `${decimals} decimals`],
              ].map(([label, value, hint]) => (
                <div key={label} className="flex flex-wrap items-center justify-between gap-2 py-3 first:pt-0 last:pb-0">
                  <dt>
                    <div className="text-sm font-medium text-fg">{label}</div>
                    <div className="text-xs text-subtle">{hint}</div>
                  </dt>
                  <dd>
                    <Address value={value} />
                  </dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader icon={<IconVault size={18} />} title="Fund the vault" description="There is no deposit instruction: send tokens of this mint to the vault address with any wallet." />
            <Address value={policy.vault} full />
            <p className="mt-3 text-xs text-subtle">Only tokens of mint {short(policy.mint)} count. Anyone can top up; only the owner can withdraw.</p>
          </Card>

          <Card>
            <CardHeader
              icon={<IconStore size={18} />}
              title="Allowlisted merchants"
              description={`${merchants.length} merchant${merchants.length === 1 ? "" : "s"} the agent may pay`}
              action={
                <ButtonLink href={`/policies/${policy.address}/merchants`} size="sm" variant="secondary">
                  Manage
                </ButtonLink>
              }
            />
            {merchants.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">
                No merchants yet — the agent cannot pay anyone.{" "}
                <Link href={`/policies/${policy.address}/merchants`} className="font-medium text-brand hover:underline">
                  Add one
                </Link>
              </p>
            ) : (
              <ul className="space-y-2">
                {merchants.slice(0, 4).map((m) => (
                  <li key={m.merchant} className="flex items-center justify-between gap-2 rounded-xl border border-line bg-canvas/40 px-3 py-2">
                    <Address value={m.merchant} />
                    {m.merchant === policy.agent ? <Badge tone="danger">Is the agent</Badge> : <Badge tone="success">Allowed</Badge>}
                  </li>
                ))}
                {merchants.length > 4 && (
                  <li className="text-center text-sm">
                    <Link href={`/policies/${policy.address}/merchants`} className="text-brand hover:underline">
                      View all {merchants.length}
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </Card>
        </div>

        {/* Right column: owner actions */}
        <div className="space-y-6">
          <Card variant={policy.isPaused ? "warning" : "default"}>
            <CardHeader
              icon={policy.isPaused ? <IconPlay size={18} /> : <IconPause size={18} />}
              title="Emergency control"
              description={
                policy.isPaused
                  ? "Payments are blocked. Resume to let the agent pay allowlisted merchants again."
                  : "Pausing blocks every agent payment immediately. Withdraw stays available."
              }
            />
            <Button
              variant={policy.isPaused ? "primary" : "danger"}
              className="w-full"
              size="lg"
              onClick={togglePause}
              loading={pauseTx.loading}
              disabled={!isOwner}
              title={ownerDisabledHint}
              icon={policy.isPaused ? <IconPlay size={18} /> : <IconPause size={18} />}
            >
              {policy.isPaused ? "Resume payments" : "Pause all payments"}
            </Button>
            {ownerDisabledHint && <p className="mt-2 text-center text-xs text-subtle">{ownerDisabledHint}</p>}
            <div className="mt-3">
              <TxFeedback
                loading={false}
                error={pauseTx.error}
                signature={pauseTx.signature}
                successTitle={policy.isPaused ? "Policy paused" : "Policy resumed"}
                onDismiss={pauseTx.reset}
              />
            </div>
          </Card>

          <Card>
            <CardHeader icon={<IconVault size={18} />} title="Withdraw" description="Move tokens from the vault back to your own token account." />
            <form onSubmit={withdraw} noValidate className="space-y-4">
              <Input
                label="Amount"
                inputMode="decimal"
                placeholder="0.00"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                disabled={!isOwner || withdrawTx.loading}
                error={withdrawError}
                hint={`Available: ${fmt(vaultBalance)}`}
                suffix="tokens"
                labelAction={
                  isOwner && vaultBalance > 0n ? (
                    <button type="button" className="text-xs font-medium text-brand hover:text-brand-strong" onClick={() => setWithdrawAmount(fmt(vaultBalance).replace(/,/g, ""))}>
                      Max
                    </button>
                  ) : undefined
                }
              />
              <Button type="submit" variant="secondary" className="w-full" loading={withdrawTx.loading} disabled={!isOwner || !withdrawUnits || Boolean(withdrawError)}>
                Withdraw to my wallet
              </Button>
              <TxFeedback error={withdrawTx.error} signature={withdrawTx.signature} successTitle="Withdrawal confirmed" onDismiss={withdrawTx.reset} />
            </form>
          </Card>

          <Card>
            <CardHeader icon={<IconSettings size={18} />} title="Update policy" description="Leave a field empty to keep its current value. Today's spend is not reset." />
            <form onSubmit={update} noValidate className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Input
                  label="Max per payment"
                  inputMode="decimal"
                  placeholder={fmt(maxPerTx)}
                  value={newMaxPerTx}
                  onChange={(e) => setNewMaxPerTx(e.target.value)}
                  disabled={!isOwner || updateTx.loading}
                  error={updateErrors.max}
                />
                <Input
                  label="Daily limit"
                  inputMode="decimal"
                  placeholder={fmt(dailyLimit)}
                  value={newDailyLimit}
                  onChange={(e) => setNewDailyLimit(e.target.value)}
                  disabled={!isOwner || updateTx.loading}
                  error={updateErrors.daily}
                />
              </div>
              <Input
                label="Replace agent"
                placeholder="New agent public key (optional)"
                value={newAgent}
                onChange={(e) => setNewAgent(e.target.value)}
                disabled={!isOwner || updateTx.loading}
                error={updateErrors.agent}
                hint="The old agent loses access as soon as this confirms."
                className="font-mono"
                spellCheck={false}
              />
              {agentWarn && <Alert tone="warning">{agentWarn}</Alert>}
              <Button type="submit" variant="secondary" className="w-full" loading={updateTx.loading} disabled={!isOwner || !updateValid}>
                Save changes
              </Button>
              <TxFeedback error={updateTx.error} signature={updateTx.signature} successTitle="Policy updated" onDismiss={updateTx.reset} />
            </form>
          </Card>
        </div>
      </div>
    </>
  );
}
