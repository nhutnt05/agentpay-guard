"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Address } from "@/components/ui/Address";
import { Alert } from "@/components/ui/Alert";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { IconBot, IconSettings, IconShield, IconStore, IconVault } from "@/components/ui/icons";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/SectionHeader";
import { MINT, MINT_DECIMALS } from "@/lib/anchor/constants";
import { policyPda } from "@/lib/anchor/pda";
import { createApiClient } from "@/lib/client/api";
import { parseDecimalAmount } from "@/lib/solana/amounts";
import { buildInitializePolicy } from "@/lib/wallet/transactions";
import { useSendTransaction } from "@/lib/wallet/useSendTransaction";
import { ConnectPrompt, isBase58Address, TxFeedback } from "./shared";

const api = createApiClient();

function toUnits(value: string): bigint | null {
  try {
    const v = parseDecimalAmount(value.trim(), MINT_DECIMALS);
    return v > 0n ? v : null;
  } catch {
    return null;
  }
}

export function CreatePolicyForm() {
  const { publicKey } = useWallet();
  const router = useRouter();
  const { send, loading, error, signature, reset } = useSendTransaction();

  const [agentAddress, setAgentAddress] = useState("");
  const [serverAgent, setServerAgent] = useState<string | null>(null);
  const [maxPerTx, setMaxPerTx] = useState("10");
  const [dailyLimit, setDailyLimit] = useState("20");
  const [touched, setTouched] = useState(false);
  const [created, setCreated] = useState<string | null>(null);

  useEffect(() => {
    void api.health().then((h) => setServerAgent((h.data?.agentPubkey as string | null) ?? null));
  }, []);

  const owner = publicKey?.toBase58() ?? "";
  const maxUnits = toUnits(maxPerTx);
  const dailyUnits = toUnits(dailyLimit);

  const errors = useMemo(() => {
    const e: { agent?: string; max?: string; daily?: string } = {};
    const a = agentAddress.trim();
    if (!a) e.agent = "Required: the public key that will sign payments.";
    else if (!isBase58Address(a)) e.agent = "Not a valid Solana address.";
    else if (a === owner) e.agent = "The agent must be a different key from the owner.";
    if (!maxUnits) e.max = `Enter an amount greater than 0 (up to ${MINT_DECIMALS} decimals).`;
    if (!dailyUnits) e.daily = `Enter an amount greater than 0 (up to ${MINT_DECIMALS} decimals).`;
    if (maxUnits && dailyUnits && maxUnits > dailyUnits) e.max = "Cannot be higher than the daily limit.";
    return e;
  }, [agentAddress, owner, maxUnits, dailyUnits]);
  const valid = Object.keys(errors).length === 0;

  if (!publicKey) {
    return (
      <>
        <PageHeader title="Create a policy" crumbs={[{ label: "Policies", href: "/policies" }, { label: "New" }]} />
        <ConnectPrompt description="The connected wallet becomes the policy owner: the only key that can change limits, manage merchants, pause or withdraw." />
      </>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!publicKey || !valid || !maxUnits || !dailyUnits) return;
    reset();
    const policyId = new Uint8Array(32);
    crypto.getRandomValues(policyId);
    try {
      const ix = await buildInitializePolicy(publicKey, policyId, new PublicKey(agentAddress.trim()), maxUnits, dailyUnits);
      const result = await send(ix);
      if (result) {
        const address = policyPda(publicKey, policyId)[0].toBase58();
        setCreated(address);
        setTimeout(() => router.push(`/policies/${address}`), 1800);
      }
    } catch (err) {
      console.error("Failed to create policy:", err);
    }
  }

  const show = (msg?: string) => (touched ? msg : undefined);

  return (
    <>
      <PageHeader
        title="Create a policy"
        description="Set who may spend, how much, and from which vault. Everything below is enforced by the on-chain program."
        crumbs={[{ label: "Policies", href: "/policies" }, { label: "New" }]}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <Card>
            <CardHeader icon={<IconShield size={18} />} title="Owner" description="Your connected wallet. Only this key can manage the policy." />
            <Address value={owner} full />
          </Card>

          <Card>
            <CardHeader icon={<IconBot size={18} />} title="Agent" description="The key your AI agent's server signs payments with. It can only pay allowlisted merchants within the limits." />
            <Input
              label="Agent public key"
              placeholder="e.g. DgyKmgoc…ZWM1"
              value={agentAddress}
              onChange={(e) => setAgentAddress(e.target.value)}
              onBlur={() => setTouched(true)}
              disabled={loading || Boolean(created)}
              error={show(errors.agent)}
              hint="Use the agent of the server you will run payments through."
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
              labelAction={
                serverAgent && agentAddress.trim() !== serverAgent ? (
                  <button
                    type="button"
                    onClick={() => setAgentAddress(serverAgent)}
                    className="text-xs font-medium text-brand transition-base hover:text-brand-strong"
                  >
                    Use this server&apos;s agent
                  </button>
                ) : undefined
              }
            />
          </Card>

          <Card>
            <CardHeader icon={<IconSettings size={18} />} title="Spending limits" description="Checked on every payment. You can change them later." />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Max per payment"
                inputMode="decimal"
                value={maxPerTx}
                onChange={(e) => setMaxPerTx(e.target.value)}
                onBlur={() => setTouched(true)}
                disabled={loading || Boolean(created)}
                error={show(errors.max)}
                suffix="tokens"
              />
              <Input
                label="Daily limit (UTC day)"
                inputMode="decimal"
                value={dailyLimit}
                onChange={(e) => setDailyLimit(e.target.value)}
                onBlur={() => setTouched(true)}
                disabled={loading || Boolean(created)}
                error={show(errors.daily)}
                suffix="tokens"
              />
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-subtle">
              Token mint <Address value={MINT.toBase58()} /> · {MINT_DECIMALS} decimals
            </div>
          </Card>

          {created ? (
            <Alert
              tone="success"
              title="Policy created"
              action={
                <ButtonLink href={`/policies/${created}`} size="sm">
                  Open policy now
                </ButtonLink>
              }
            >
              Redirecting to your new policy… Next: fund the vault and allowlist merchants.
            </Alert>
          ) : (
            <TxFeedback loading={loading} error={error} signature={signature} successTitle="Policy created" onDismiss={reset} />
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <ButtonLink href="/policies" variant="ghost">
              Cancel
            </ButtonLink>
            <Button type="submit" size="lg" loading={loading} disabled={Boolean(created) || (touched && !valid)}>
              {loading ? "Confirm in wallet…" : "Create policy"}
            </Button>
          </div>
        </form>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="bg-elevated/60">
            <h2 className="text-sm font-semibold text-fg">What gets created</h2>
            <ul className="mt-3 space-y-3 text-sm text-muted">
              <li className="flex gap-2.5">
                <IconShield size={16} className="mt-0.5 shrink-0 text-brand" /> A policy account (PDA) storing owner, agent and limits.
              </li>
              <li className="flex gap-2.5">
                <IconVault size={16} className="mt-0.5 shrink-0 text-brand" /> A vault token account that only the program can move funds from.
              </li>
            </ul>
            <p className="mt-4 text-xs text-subtle">Your wallet pays the account rent and the network fee (devnet SOL).</p>
          </Card>
          <Card className="bg-elevated/60">
            <h2 className="text-sm font-semibold text-fg">Next steps</h2>
            <ol className="mt-3 space-y-3 text-sm text-muted">
              <li className="flex gap-2.5">
                <IconVault size={16} className="mt-0.5 shrink-0 text-subtle" /> Fund the vault with a normal token transfer.
              </li>
              <li className="flex gap-2.5">
                <IconStore size={16} className="mt-0.5 shrink-0 text-subtle" /> Allowlist the merchants the agent may pay.
              </li>
              <li className="flex gap-2.5">
                <IconBot size={16} className="mt-0.5 shrink-0 text-subtle" /> Try it in the{" "}
                <Link href="/agent" className="text-brand hover:underline">
                  AI Playground
                </Link>
                .
              </li>
            </ol>
          </Card>
        </aside>
      </div>
    </>
  );
}
