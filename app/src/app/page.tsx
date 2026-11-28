import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { ExplorerLink } from "@/components/ui/ExplorerLink";

// Landing page. Devnet evidence signatures from README (real transactions).
const EVIDENCE = [
  { label: "Normal payment", sig: "22FHzVgQY9SbgeVUrFWc9BAZKgMa1bcCqw7KMGSzUBCZCNbYc83tvrdRN7u3hFe46CYrVgx23dXeiMc5abi4UM1q" },
  { label: "Prompt injection blocked", sig: "6iV1W5fuJc3ZtPiYfWDgijLJagUziewFabc4e6mhxLFBK23hpqHV4UUMr11eVSkViJgorCz7T78cr2TAgdUHcUC" },
  { label: "Above limit", sig: "3xjA76DMsx4ZyP74aYZNe7sNJoPBxStHP42RdVHbDDdtuXmoSvEU3GbuGLpbPVUtWqYX63EpjgaQnP5gN34yN3K3" },
  { label: "Duplicate blocked", sig: "2rai6BbYjeRkCZLRyVWeB97RCrqWr4Xh65eGXaRdShJ4SNY7F5Q5EqAfvbe4ZQcNMeGE9rvGbu9GXV3RpFJYGt9Y" },
  { label: "Policy paused", sig: "2yrSBkG2WVpzEC4e35ohGYkNCEKpRBztAAGgbKM4cE8KLwLp4mf5bQsxqiHqfEC715BoVT1PtxoLtKuZELfU41pz" },
];

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-16 px-4 py-16">
      {/* Hero */}
      <section className="flex flex-col items-center gap-8 text-center">
        <div className="flex flex-col gap-4">
          <h1 className="text-5xl font-bold tracking-tight text-zinc-100 sm:text-6xl">
            Let AI transact.
            <br />
            <span className="bg-gradient-to-r from-[#14F195] to-emerald-400 bg-clip-text text-transparent">
              Never let AI bypass your payment rules.
            </span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-zinc-400">
            An on-chain payment firewall for AI agents on Solana. AI decides what to pay. The on-chain policy decides whether it&apos;s allowed.
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4">
          <Link href="/policies">
            <Button variant="primary" size="lg">
              My Policies
            </Button>
          </Link>
          <Link href="/security">
            <Button variant="secondary" size="lg">
              Security Demo
            </Button>
          </Link>
          <Link href="/agent">
            <Button variant="secondary" size="lg">
              AI Playground
            </Button>
          </Link>
        </div>
      </section>

      {/* Features */}
      <section className="grid gap-6 sm:grid-cols-3">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-[#14F195]/10">
            <svg className="h-6 w-6 text-[#14F195]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-zinc-100">PDA-Controlled Vault</h3>
          <p className="text-sm text-zinc-400">
            Funds sit in a vault controlled by a program-derived address. No private key can move them — only the on-chain program.
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-[#14F195]/10">
            <svg className="h-6 w-6 text-[#14F195]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-zinc-100">Allowlist + Limits</h3>
          <p className="text-sm text-zinc-400">
            On-chain merchant allowlist enforced at every payment. Per-transaction and daily spending limits prevent overspending.
          </p>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-6">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-[#14F195]/10">
            <svg className="h-6 w-6 text-[#14F195]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
            </svg>
          </div>
          <h3 className="mb-2 text-lg font-semibold text-zinc-100">Emergency Pause</h3>
          <p className="text-sm text-zinc-400">
            Owner can pause the policy at any time. Every agent payment is immediately refused until resumed.
          </p>
        </div>
      </section>

      {/* Devnet Evidence */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-950 p-8">
        <h2 className="mb-4 text-2xl font-semibold text-zinc-100">Verified on Devnet</h2>
        <p className="mb-6 text-sm text-zinc-400">
          Every result shown in the demo comes from real Solana devnet transactions. Click to view on Explorer:
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {EVIDENCE.map((item) => (
            <div key={item.sig} className="rounded border border-zinc-800 bg-zinc-900/50 p-3">
              <div className="mb-1 text-xs font-medium text-zinc-400">{item.label}</div>
              <ExplorerLink 
                href={`https://explorer.solana.com/tx/${item.sig}?cluster=devnet`}
                label={`${item.sig.slice(0, 8)}…${item.sig.slice(-6)}`}
              />
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="flex flex-col items-center gap-4 rounded-lg border border-zinc-800 bg-zinc-950 p-12 text-center">
        <h2 className="text-2xl font-semibold text-zinc-100">Ready to explore?</h2>
        <p className="max-w-xl text-zinc-400">
          Try the Security Demo to see how the firewall blocks attacks, or use the AI Playground to let an agent analyze a page and propose a payment.
        </p>
        <div className="flex gap-4">
          <Link href="/security">
            <Button variant="primary">Security Demo</Button>
          </Link>
          <Link href="/agent">
            <Button variant="secondary">AI Playground</Button>
          </Link>
        </div>
      </section>
    </main>
  );
}
