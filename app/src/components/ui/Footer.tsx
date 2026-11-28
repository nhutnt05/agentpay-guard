import Link from "next/link";
import { APP_NAME } from "@/config/app";
import { PROGRAM_ID } from "@/lib/anchor/constants";
import { explorerAddressUrl } from "@/lib/solana/explorer";

export function Footer() {
  const program = PROGRAM_ID.toBase58();
  return (
    <footer className="mt-auto border-t border-line/80">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 text-sm text-subtle sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p>
          <span className="font-medium text-muted">{APP_NAME}</span> · on-chain payment firewall for AI agents · Solana devnet
        </p>
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <li>
              <Link href="/policies" className="transition-base hover:text-fg">
                Policies
              </Link>
            </li>
            <li>
              <Link href="/agent" className="transition-base hover:text-fg">
                AI Playground
              </Link>
            </li>
            <li>
              <Link href="/security" className="transition-base hover:text-fg">
                Security Demo
              </Link>
            </li>
            <li>
              <a href={explorerAddressUrl(program)} target="_blank" rel="noreferrer noopener" className="font-mono transition-base hover:text-fg">
                Program {program.slice(0, 4)}…{program.slice(-4)}
              </a>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
