"use client";

import { useCallback, useEffect, useState } from "react";
import { Address } from "@/components/ui/Address";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconBot, IconCircleCheck, IconCircleX, IconReceipt, IconRefresh } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/SectionHeader";
import { Skeleton } from "@/components/ui/Spinner";
import { type AnyData, createApiClient } from "@/lib/client/api";
import { reasonLabel } from "@/lib/demo/labels";
import { formatBaseUnits } from "@/lib/solana/amounts";
import { cn } from "@/lib/ui/cn";
import { PolicyTabs, short } from "./shared";

const api = createApiClient();
type Filter = "all" | "paid" | "rejected";

function when(ts: number | null | undefined) {
  return ts ? new Date(ts * 1000).toLocaleString() : "—";
}

/**
 * Payment history read from chain via GET /api/v1/policies/[id]/payments: live receipts,
 * payments whose receipt was closed (F-02), and rejected on-chain attempts.
 */
export function PaymentsHistory({ policyAddress }: { policyAddress: string }) {
  const [items, setItems] = useState<AnyData[]>([]);
  const [decimals, setDecimals] = useState(6);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [res, pol] = await Promise.all([api.payments(policyAddress, 50), api.policy(policyAddress)]);
    if (res.ok) setItems((res.data?.items as AnyData[]) ?? []);
    else setError(res.error?.message ?? "Failed to load payments");
    if (pol.ok && typeof pol.data?.decimals === "number") setDecimals(pol.data.decimals);
    setLoading(false);
  }, [policyAddress]);

  useEffect(() => {
    // Fetch on mount / policy change; state is set after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const paid = items.filter((i) => i.kind !== "FAILED_TX");
  const rejected = items.filter((i) => i.kind === "FAILED_TX");
  const shown = filter === "paid" ? paid : filter === "rejected" ? rejected : items;
  const chips: Array<[Filter, string, number]> = [
    ["all", "All", items.length],
    ["paid", "Paid", paid.length],
    ["rejected", "Rejected", rejected.length],
  ];

  return (
    <>
      <PageHeader
        crumbs={[{ label: "Policies", href: "/policies" }, { label: short(policyAddress), href: `/policies/${policyAddress}` }, { label: "Payments" }]}
        title="Payment history"
        description="Successful payments and rejected on-chain attempts, read from Solana. Simulated rejections never reach the chain and are not listed."
        actions={
          <Button variant="ghost" onClick={() => void load()} loading={loading} icon={<IconRefresh size={16} />}>
            Refresh
          </Button>
        }
      />
      <PolicyTabs policyId={policyAddress} />

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Filter payments">
        {chips.map(([key, label, n]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "rounded-full border px-3.5 py-1.5 text-sm font-medium transition-base",
              filter === key ? "border-brand/40 bg-brand/10 text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg",
            )}
          >
            {label} <span className="ml-1 tabular-nums text-subtle">{n}</span>
          </button>
        ))}
      </div>

      {error && (
        <Alert tone="danger" title="Could not load payments" className="mb-4" action={<Button size="sm" variant="secondary" onClick={() => void load()}>Try again</Button>}>
          {error}
        </Alert>
      )}

      <Card className="p-0">
        {loading && items.length === 0 ? (
          <div className="space-y-4 p-5" aria-hidden="true">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={<IconReceipt size={22} />}
            title={filter === "rejected" ? "No rejected attempts on-chain" : "No payments yet"}
            description="When the agent pays an allowlisted merchant, the receipt appears here."
            action={
              <ButtonLink href={`/agent?policy=${policyAddress}`} variant="secondary" icon={<IconBot size={16} />}>
                Try a payment in the AI Playground
              </ButtonLink>
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {shown.map((it) => {
              const failed = it.kind === "FAILED_TX";
              return (
                <li key={it.receipt ?? it.signature} className="flex flex-col gap-3 px-5 py-4 transition-base hover:bg-elevated/40 sm:flex-row sm:items-center sm:justify-between animate-fade-in">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5">{failed ? <IconCircleX className="text-danger" /> : <IconCircleCheck className="text-brand" />}</span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {failed ? (
                          <span className="font-medium text-fg">{reasonLabel(it.reason) ?? "Rejected"}</span>
                        ) : (
                          <span className="font-medium tabular-nums text-fg">
                            {it.amount ? formatBaseUnits(BigInt(it.amount), decimals) : "—"} {it.amount && BigInt(it.amount) === 10n ** BigInt(decimals) ? "token" : "tokens"}
                          </span>
                        )}
                        {failed ? (
                          <Badge tone="danger">Rejected on-chain</Badge>
                        ) : it.receiptClosed ? (
                          <Badge tone="neutral">Paid · receipt closed</Badge>
                        ) : (
                          <Badge tone="success">Paid</Badge>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-subtle">
                        {when(it.timestamp)}
                        {!failed && it.merchant && <> · to {short(it.merchant)}</>}
                      </div>
                    </div>
                  </div>
                  <div className="sm:shrink-0">
                    {it.signature ? <Address value={it.signature} kind="tx" /> : it.receipt ? <Address value={it.receipt} /> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-xs text-subtle">
        Receipts may be closed after their request expired plus one day (rent returns to the agent). Those payments stay listed from their
        transaction log while the RPC keeps that history.
      </p>
    </>
  );
}
