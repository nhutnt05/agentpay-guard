/** Link to Solana Explorer (the URL is built server-side for the configured cluster). */
export function ExplorerLink({ href, label }: { href: string | null | undefined; label: string }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="break-all text-sky-700 underline dark:text-sky-400">
      {label}
    </a>
  );
}

/** Shortens a base58 key/signature for display: first 6 … last 4. */
export function short(value: string | null | undefined): string {
  if (!value) return "—";
  return value.length > 14 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}
