"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useEffect, useState } from "react";
import { Address } from "@/components/ui/Address";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconPlus, IconRefresh, IconStore, IconTrash, IconVault } from "@/components/ui/icons";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/SectionHeader";
import { LoadingBlock } from "@/components/ui/Spinner";
import { usePolicyData } from "@/lib/client/usePolicyData";
import { addMerchantIx, removeMerchantIx } from "@/lib/wallet/transactions";
import { useSendTransaction } from "@/lib/wallet/useSendTransaction";
import { isBase58Address, PolicyTabs, short, TxFeedback } from "./shared";

export function MerchantsManager({ policyAddress }: { policyAddress: string }) {
  const { publicKey, connected } = useWallet();
  const { policy, merchants, loading, refreshing, error, reload } = usePolicyData(policyAddress);
  const addTx = useSendTransaction();
  const removeTx = useSendTransaction();
  const [merchant, setMerchant] = useState("");
  const [touched, setTouched] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const lastSig = addTx.signature ?? removeTx.signature;
  useEffect(() => {
    if (!lastSig) return;
    const t = setTimeout(() => void reload(), 1500);
    return () => clearTimeout(t);
  }, [lastSig, reload]);

  if (loading) return <LoadingBlock label="Reading allowlist from chain…" />;
  if (error || !policy) {
    return (
      <Card className="mx-auto max-w-xl">
        <EmptyState
          icon={<IconVault size={24} />}
          title="Policy not found"
          description={error ?? "There is no AgentPay Guard policy at this address."}
          action={<ButtonLink href="/policies">Back to policies</ButtonLink>}
        />
      </Card>
    );
  }

  const isOwner = connected && publicKey?.toBase58() === policy.owner;
  const value = merchant.trim();
  const listed = merchants.some((m) => m.merchant === value);
  const addError = !value
    ? touched
      ? "Enter the merchant's wallet address."
      : null
    : !isBase58Address(value)
      ? "Not a valid Solana address."
      : value === policy.agent
        ? "This is the policy's agent — the program refuses it (an agent must never be able to pay itself)."
        : value === policy.address || value === policy.vault
          ? "The policy or its vault cannot be a merchant."
          : listed
            ? "Already on the allowlist."
            : null;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!publicKey || !isOwner || !value || addError) return;
    removeTx.reset();
    try {
      const res = await addTx.send(await addMerchantIx(new PublicKey(policy!.address), publicKey, new PublicKey(value)));
      if (res) {
        setMerchant("");
        setTouched(false);
      }
    } catch (err) {
      console.error("add merchant failed:", err);
    }
  }

  async function remove(address: string) {
    if (!publicKey || !isOwner) return;
    addTx.reset();
    setRemoving(address);
    try {
      await removeTx.send(await removeMerchantIx(new PublicKey(policy!.address), publicKey, new PublicKey(address)));
    } catch (err) {
      console.error("remove merchant failed:", err);
    } finally {
      setRemoving(null);
      setConfirming(null);
    }
  }

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Policies", href: "/policies" }, { label: short(policy.address), href: `/policies/${policy.address}` }, { label: "Merchants" }]}
        title="Merchant allowlist"
        description="The agent can only pay these wallets. Every entry is an on-chain account checked on each payment."
        actions={
          <Button variant="ghost" onClick={() => void reload()} loading={refreshing} icon={<IconRefresh size={16} />}>
            Refresh
          </Button>
        }
      />
      <PolicyTabs policyId={policy.address} />

      {!isOwner && (
        <Alert tone="info" title={connected ? "You are not the owner" : "Read-only view"} className="mb-6">
          {connected ? "Only the policy owner can add or remove merchants." : "Connect the owner wallet to add or remove merchants."}
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card className="order-2 lg:order-1">
          <CardHeader
            icon={<IconStore size={18} />}
            title={`${merchants.length} allowlisted ${merchants.length === 1 ? "merchant" : "merchants"}`}
            description="Removing a merchant closes its account and refunds the rent to the owner."
          />
          {merchants.length === 0 ? (
            <EmptyState
              icon={<IconStore size={22} />}
              title="No merchants yet"
              description="Until you add one, every agent payment is rejected — which is a safe default."
            />
          ) : (
            <ul className="divide-y divide-line">
              {merchants.map((m) => (
                <li key={m.merchant} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0 animate-fade-in">
                  <div className="min-w-0">
                    <Address value={m.merchant} />
                    <div className="mt-1 text-xs text-subtle">
                      Added {m.createdAt ? new Date(m.createdAt * 1000).toLocaleString() : "—"}
                      {m.merchant === policy.agent && <Badge tone="danger" className="ml-2">Is the agent</Badge>}
                    </div>
                  </div>
                  {isOwner &&
                    (confirming === m.merchant ? (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted">Remove?</span>
                        <Button size="sm" variant="danger" loading={removing === m.merchant} onClick={() => void remove(m.merchant)}>
                          Confirm
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(null)} disabled={removing === m.merchant}>
                          Cancel
                        </Button>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<IconTrash size={15} />}
                        onClick={() => setConfirming(m.merchant)}
                        disabled={Boolean(removing) || addTx.loading}
                        aria-label={`Remove merchant ${m.merchant}`}
                      >
                        Remove
                      </Button>
                    ))}
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <TxFeedback error={removeTx.error} signature={removeTx.signature} successTitle="Merchant removed" onDismiss={removeTx.reset} />
          </div>
        </Card>

        <Card className="order-1 lg:order-2 lg:sticky lg:top-24 lg:self-start">
          <CardHeader icon={<IconPlus size={18} />} title="Add merchant" description="Use the merchant's wallet address (not its token account)." />
          <form onSubmit={add} noValidate className="space-y-4">
            <Input
              label="Merchant wallet"
              placeholder="Wallet public key"
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              onBlur={() => value && setTouched(true)}
              disabled={!isOwner || addTx.loading}
              error={addError}
              hint="To receive payments the merchant needs a token account (ATA) for this policy's mint."
              className="font-mono"
              spellCheck={false}
              autoComplete="off"
            />
            <Button type="submit" className="w-full" loading={addTx.loading} disabled={!isOwner || Boolean(addError) || !value} icon={<IconPlus size={16} />}>
              Add to allowlist
            </Button>
            <TxFeedback loading={false} error={addTx.error} signature={addTx.signature} successTitle="Merchant added" onDismiss={addTx.reset} />
          </form>
        </Card>
      </div>
    </>
  );
}
