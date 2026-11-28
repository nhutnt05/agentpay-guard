"use client";

import { useState } from "react";
import { cn } from "@/lib/ui/cn";
import { explorerAddressUrl, explorerTxUrl } from "@/lib/solana/explorer";
import { short } from "./ExplorerLink";
import { IconCheck, IconCopy, IconExternal } from "./icons";

interface AddressProps {
  value: string;
  /** "address" (default) or "tx" — decides the Explorer link. */
  kind?: "address" | "tx";
  /** Show the full value instead of the shortened form. */
  full?: boolean;
  className?: string;
}

/** Monospace address/signature chip with copy-to-clipboard and an Explorer link. */
export function Address({ value, kind = "address", full = false, className = "" }: AddressProps) {
  const [copied, setCopied] = useState(false);
  const href = kind === "tx" ? explorerTxUrl(value) : explorerAddressUrl(value);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (insecure context): nothing to do.
    }
  }

  return (
    <span
      className={cn(
        "inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg border border-line bg-canvas/50 py-0.5 pl-2 pr-0.5 font-mono text-[13px] text-fg",
        className,
      )}
    >
      {/* min-w-0 lets the text shrink inside the flex chip, so long values never widen the page. */}
      <span className={cn("min-w-0", full ? "break-all" : "truncate")} title={value}>
        {full ? value : short(value)}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Copied" : "Copy to clipboard"}
        title={copied ? "Copied" : "Copy"}
        className="shrink-0 rounded-md p-1 text-subtle transition-base hover:bg-elevated hover:text-fg"
      >
        {copied ? <IconCheck size={14} className="text-brand" /> : <IconCopy size={14} />}
      </button>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Open in Solana Explorer"
        title="Open in Solana Explorer"
        className="shrink-0 rounded-md p-1 text-subtle transition-base hover:bg-elevated hover:text-fg"
      >
        <IconExternal size={14} />
      </a>
    </span>
  );
}
