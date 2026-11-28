"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Address } from "@/components/ui/Address";
import { Alert } from "@/components/ui/Alert";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconWallet } from "@/components/ui/icons";
import { WalletButton } from "@/components/wallet/WalletButton";
import { cn } from "@/lib/ui/cn";

/** Overview / Merchants / Payments tabs for one policy. */
export function PolicyTabs({ policyId }: { policyId: string }) {
  const pathname = usePathname();
  const base = `/policies/${policyId}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/merchants`, label: "Merchants" },
    { href: `${base}/payments`, label: "Payments" },
  ];
  return (
    <nav aria-label="Policy sections" className="mb-8 border-b border-line">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <li key={t.href}>
              <Link
                href={t.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex border-b-2 px-4 py-2.5 text-sm font-medium transition-base whitespace-nowrap",
                  active ? "border-brand text-fg" : "border-transparent text-muted hover:border-line-strong hover:text-fg",
                )}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Shown when a page needs a connected owner wallet. */
export function ConnectPrompt({ title = "Connect your wallet", description }: { title?: string; description?: ReactNode }) {
  return (
    <Card className="mx-auto max-w-xl">
      <EmptyState
        icon={<IconWallet size={24} />}
        title={title}
        description={description ?? "Connect a Phantom or Solflare wallet set to Devnet. Your keys never leave the wallet."}
        action={<WalletButton />}
      />
    </Card>
  );
}

/** Result of an owner transaction: signing, confirmed (with Explorer link) or failed. */
export function TxFeedback({
  loading,
  signature,
  error,
  successTitle,
  onDismiss,
}: {
  loading?: boolean;
  signature?: string | null;
  error?: string | null;
  successTitle: string;
  onDismiss?: () => void;
}) {
  if (loading) {
    return (
      <Alert tone="info" title="Waiting for your wallet…">
        Approve the transaction in your wallet. It is confirmed on-chain before this page updates.
      </Alert>
    );
  }
  if (error) {
    return (
      <Alert tone="danger" title="Transaction failed" onDismiss={onDismiss}>
        {friendlyTxError(error)}
      </Alert>
    );
  }
  if (signature) {
    return (
      <Alert tone="success" title={successTitle} onDismiss={onDismiss}>
        <span className="inline-flex flex-wrap items-center gap-2">
          Confirmed on-chain: <Address value={signature} kind="tx" />
        </span>
      </Alert>
    );
  }
  return null;
}

/** Turns common wallet/program errors into plain language (the raw text stays visible). */
export function friendlyTxError(raw: string): string {
  if (/user rejected|rejected the request|declined/i.test(raw)) return "You rejected the request in your wallet. Nothing was sent.";
  if (/insufficient (funds|lamports)|0x1\b/i.test(raw)) return `Not enough SOL for fees or rent in your wallet. (${raw})`;
  if (/Invalid public key|invalid.*base58|Non-base58/i.test(raw)) return "One of the addresses is not a valid Solana address.";
  return raw;
}

/** True for a syntactically valid base58 Solana address (32–44 chars). */
export function isBase58Address(value: string): boolean {
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(value.trim());
}

export { Address };
export { short } from "@/components/ui/ExplorerLink";
