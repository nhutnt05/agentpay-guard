import Link from "next/link";
import { APP_NAME, APP_TAGLINE } from "@/config/app";

// Home. Dashboard / Create Policy / Policy Details / Merchants / History arrive with
// T-M4-07 and T-M4-08 (they need the wallet connection). The Security Demo and Agent
// Playground work with a pasted policy address.
export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">{APP_NAME}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{APP_TAGLINE}</p>
      </div>
      <nav className="grid gap-3 sm:grid-cols-2">
        <Link href="/security" className="rounded border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800">
          <div className="font-semibold">Security Demo</div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Six attack and control scenarios against the on-chain policy.</div>
        </Link>
        <Link href="/agent" className="rounded border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800">
          <div className="font-semibold">AI Agent Playground</div>
          <div className="text-sm text-zinc-600 dark:text-zinc-400">Let the agent read a page and propose a payment.</div>
        </Link>
      </nav>
      <p className="text-sm text-zinc-500">Wallet-based pages (Dashboard, Create Policy, Policy Details) are not built yet.</p>
    </main>
  );
}
