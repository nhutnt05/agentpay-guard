import { cn } from "@/lib/ui/cn";
import { IconExternal } from "./icons";

/** Link to Solana Explorer (build the URL with lib/solana/explorer for the configured cluster). */
export function ExplorerLink({ href, label, className = "" }: { href: string | null | undefined; label: string; className?: string }) {
  if (!href) return null;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        "inline-flex items-center gap-1 break-all font-mono text-[13px] text-info underline-offset-4 transition-base hover:text-fg hover:underline",
        className,
      )}
    >
      {label}
      <IconExternal size={13} className="shrink-0 opacity-70" />
      <span className="sr-only">(opens Solana Explorer in a new tab)</span>
    </a>
  );
}

/** Shortens a base58 key/signature for display: first 6 … last 4. */
export function short(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
