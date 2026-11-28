"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import Link from "next/link";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { short } from "@/components/ui/ExplorerLink";
import { IconArrowRight, IconBot, IconPlus, IconRefresh, IconShield } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Spinner";
import { Meter } from "@/components/ui/StatCard";
import { formatBaseUnits } from "@/lib/solana/amounts";
import { type OwnerPolicySummary, useOwnerPolicies } from "@/lib/wallet/useOwnerPolicies";
import { ConnectPrompt } from "./shared";

function PolicyCard({ p }: { p: OwnerPolicySummary }) {
  const fmt = (v: bigint) => formatBaseUnits(v, p.decimals);
  return (
    <Card interactive as="article" className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/policies/${p.address}`} className="font-mono text-sm font-semibold text-fg hover:text-brand">
            {short(p.address)}
          </Link>
          <p className="mt-0.5 text-xs text-subtle">Mint {short(p.mint)}</p>
        </div>
        <Badge tone={p.isPaused ? "warning" : "success"} dot>
          {p.isPaused ? "Paused" : "Active"}
        </Badge>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-4">
        <div>
          <dt className="text-xs text-subtle">Vault balance</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{p.vaultBalance === null ? "—" : fmt(p.vaultBalance)}</dd>
        </div>
        <div>
          <dt className="text-xs text-subtle">Max per payment</dt>
          <dd className="mt-1 text-lg font-semibold tabular-nums text-fg">{fmt(p.maxPerTx)}</dd>
        </div>
      </dl>

      <div className="mt-4">
        <div className="flex justify-between text-xs text-subtle">
          <span>Spent today</span>
          <span className="tabular-nums text-muted">
            {fmt(p.effectiveSpentToday)} / {fmt(p.dailyLimit)}
          </span>
        </div>
        <Meter value={p.effectiveSpentToday} max={p.dailyLimit} label="Spent today vs daily limit" />
      </div>

      <div className="mt-auto flex gap-2 pt-4">
        <ButtonLink href={`/policies/${p.address}`} size="sm" variant="secondary" className="flex-1">
          Manage <IconArrowRight size={15} />
        </ButtonLink>
        <ButtonLink href={`/agent?policy=${p.address}`} size="sm" variant="ghost" icon={<IconBot size={15} />}>
          Use with agent
        </ButtonLink>
      </div>
    </Card>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <Skeleton className="h-4 w-32" />
          <Skeleton className="mt-6 h-6 w-24" />
          <Skeleton className="mt-5 h-2 w-full" />
          <Skeleton className="mt-6 h-8 w-full" />
        </Card>
      ))}
    </div>
  );
}

export function PoliciesDashboard() {
  const { publicKey } = useWallet();
  const { policies, loading, error, reload } = useOwnerPolicies(publicKey);

  const header = (
    <PageHeader
      title="Policies"
      description="Each policy is an on-chain firewall: a vault, an agent key, spending limits and a merchant allowlist."
      actions={
        publicKey && (
          <>
            <Button variant="ghost" onClick={() => void reload()} disabled={loading} icon={<IconRefresh size={16} />}>
              Refresh
            </Button>
            <ButtonLink href="/policies/new" icon={<IconPlus size={16} />}>
              New policy
            </ButtonLink>
          </>
        )
      }
    />
  );

  if (!publicKey) {
    return (
      <>
        {header}
        <ConnectPrompt description="Connect the wallet that owns your policies (Devnet). Without a wallet you can still explore the Security Demo and the AI Playground." />
        <p className="mt-6 text-center text-sm text-muted">
          Just looking?{" "}
          <Link href="/security" className="font-medium text-brand hover:underline">
            Watch the firewall block attacks →
          </Link>
        </p>
      </>
    );
  }

  const active = policies.filter((p) => !p.isPaused).length;

  return (
    <>
      {header}
      {error && (
        <Alert tone="danger" title="Could not load your policies" className="mb-6" action={<Button size="sm" variant="secondary" onClick={() => void reload()}>Try again</Button>}>
          {error}
        </Alert>
      )}
      {loading && policies.length === 0 ? (
        <SkeletonGrid />
      ) : policies.length === 0 && !error ? (
        <Card>
          <EmptyState
            icon={<IconShield size={24} />}
            title="No policies yet"
            description="Create your first policy: choose the agent key, set per-payment and daily limits, then allowlist the merchants it may pay."
            action={
              <ButtonLink href="/policies/new" icon={<IconPlus size={16} />}>
                Create your first policy
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-3 text-sm animate-fade-in">
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-muted">
              <span className="font-semibold text-fg">{policies.length}</span> {policies.length === 1 ? "policy" : "policies"}
            </span>
            <span className="rounded-full border border-line bg-surface px-3 py-1 text-muted">
              <span className="font-semibold text-brand">{active}</span> active
            </span>
            {policies.length - active > 0 && (
              <span className="rounded-full border border-line bg-surface px-3 py-1 text-muted">
                <span className="font-semibold text-warning">{policies.length - active}</span> paused
              </span>
            )}
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {policies.map((p, i) => (
              <div key={p.address} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 50}ms` }}>
                <PolicyCard p={p} />
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
