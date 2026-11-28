import { Badge } from "@/components/ui/Badge";
import { ButtonLink } from "@/components/ui/Button";
import {
  IconArrowRight,
  IconBolt,
  IconBot,
  IconCircleCheck,
  IconCircleX,
  IconClock,
  IconExternal,
  IconList,
  IconPause,
  IconReceipt,
  IconShield,
  IconVault,
} from "@/components/ui/icons";
import { explorerTxUrl } from "@/lib/solana/explorer";

// Real devnet transactions (docs/evidence/DEVNET_EVIDENCE.md).
const EVIDENCE = [
  { label: "Normal payment", ok: true, sig: "22FHzVgQY9SbgeVUrFWc9BAZKgMa1bcCqw7KMGSzUBCZCNbYc83tvrdRN7u3hFe46CYrVgx23dXeiMc5abi4UM1q" },
  { label: "Prompt injection blocked", ok: false, sig: "6iV1W5fuJc3ZtPiYfWDgijLJagUziewFabc4e6mhxLFBK23hpqHV4UUMr11eVSkViJgorCz7T78cr2TAgdUHcUC" },
  { label: "Above per-tx limit", ok: false, sig: "3xjA76DMsx4ZyP74aYZNe7sNJoPBxStHP42RdVHbDDdtuXmoSvEU3GbuGLpbPVUtWqYX63EpjgaQnP5gN34yN3K3" },
  { label: "Duplicate request blocked", ok: false, sig: "2rai6BbYjeRkCZLRyVWeB97RCrqWr4Xh65eGXaRdShJ4SNY7F5Q5EqAfvbe4ZQcNMeGE9rvGbu9GXV3RpFJYGt9Y" },
  { label: "Paused policy blocked", ok: false, sig: "2yrSBkG2WVpzEC4e35ohGYkNCEKpRBztAAGgbKM4cE8KLwLp4mf5bQsxqiHqfEC715BoVT1PtxoLtKuZELfU41pz" },
  { label: "x402 payment via firewall", ok: true, sig: "3jy7gdvsfRoHLGumYKDMFr1jvys4XQiDZDGyzX7cscKGWGor8KCAmXXbr9Ykz6KXH93JaREwMkhQM4aM8CP5rvje" },
];

const FEATURES = [
  { icon: <IconVault />, title: "PDA-controlled vault", text: "Funds sit in a token account owned by a program-derived address. No private key can move them — only the program's rules." },
  { icon: <IconList />, title: "Merchant allowlist", text: "The agent can only pay wallets the owner approved on-chain. Anything else is rejected, even if the AI is convinced otherwise." },
  { icon: <IconClock />, title: "Spending limits", text: "Per-transaction and daily caps, plus optional rolling 24-hour and per-merchant limits — enforced in the same transaction." },
  { icon: <IconReceipt />, title: "Replay protection", text: "Every payment is bound to a canonical request hash and expiry. A receipt account makes each request executable exactly once." },
  { icon: <IconPause />, title: "Emergency pause", text: "One owner signature freezes all agent payments instantly. Withdraw remains available to the owner at any time." },
  { icon: <IconBolt />, title: "Token-2022 & x402", text: "Works with Token-2022 stablecoins under an extension policy, and pays HTTP 402 resources through the same firewall." },
];

const STEPS = [
  { n: "01", title: "Owner sets the rules", text: "Create a policy from your wallet: agent key, limits and the merchants it may pay. Fund the vault with a normal token transfer." },
  { n: "02", title: "AI proposes a payment", text: "The agent reads a page or an invoice and proposes who to pay and how much. Its output is treated as untrusted input." },
  { n: "03", title: "The chain decides", text: "The Anchor program checks every rule atomically. If one fails, nothing moves — no transfer, no receipt, no counter change." },
];

function DecisionPreview() {
  const rows = [
    { label: "Signer is the policy agent", ok: true },
    { label: "Merchant on allowlist", ok: false },
    { label: "Within per-tx & daily limit", ok: true },
    { label: "Request hash unused & unexpired", ok: true },
  ];
  return (
    <div className="relative mx-auto w-full max-w-md animate-fade-up [animation-delay:150ms]">
      <div className="absolute -inset-6 rounded-[28px] bg-linear-to-br from-brand/20 via-transparent to-accent/25 blur-2xl" aria-hidden="true" />
      <div className="relative rounded-2xl border border-line bg-surface/90 p-5 shadow-2xl backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-fg">
            <IconBot className="text-accent" /> Agent payment request
          </div>
          <Badge tone="neutral">execute_payment</Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-canvas/60 p-3 text-xs">
          <div>
            <div className="text-subtle">Pay to</div>
            <div className="mt-0.5 font-mono text-fg">7Ewu…ahW8</div>
          </div>
          <div>
            <div className="text-subtle">Amount</div>
            <div className="mt-0.5 font-mono text-fg">50.00 tUSDC</div>
          </div>
        </div>
        <ul className="mt-4 space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between rounded-lg px-1 text-sm">
              <span className="text-muted">{r.label}</span>
              {r.ok ? <IconCircleCheck className="text-brand" /> : <IconCircleX className="text-danger" />}
            </li>
          ))}
        </ul>
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-danger/35 bg-danger/8 px-3 py-2.5 text-sm">
          <IconShield className="text-danger" />
          <span className="font-semibold text-fg">Rejected on-chain</span>
          <span className="text-muted">· vault unchanged</span>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <main className="relative flex-1 overflow-hidden">
      <div className="grid-glow pointer-events-none absolute inset-x-0 top-0 h-[640px]" aria-hidden="true" />

      {/* Hero */}
      <section className="relative mx-auto grid max-w-7xl items-center gap-14 px-4 pb-20 pt-16 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:px-8 lg:pt-24">
        <div className="animate-fade-up">
          <Badge tone="success" dot>
            Live on Solana devnet
          </Badge>
          <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight text-fg sm:text-5xl lg:text-6xl">
            Let AI transact.
            <br />
            <span className="text-gradient-brand">Never let it bypass your rules.</span>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted sm:text-lg">
            AgentPay Guard is an on-chain payment firewall for AI agents. The AI decides what it wants to pay — your Solana policy decides
            whether it is allowed.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href="/policies" size="lg" icon={<IconShield size={18} />}>
              Open dashboard
            </ButtonLink>
            <ButtonLink href="/security" size="lg" variant="secondary">
              Watch attacks get blocked <IconArrowRight size={18} />
            </ButtonLink>
          </div>
          <dl className="mt-10 grid max-w-lg grid-cols-3 gap-6 border-t border-line pt-6">
            {[
              ["8", "rules per payment"],
              ["0", "keys that can move the vault"],
              ["1×", "execution per request"],
            ].map(([k, v]) => (
              <div key={v}>
                <dt className="sr-only">{v}</dt>
                <dd className="text-2xl font-semibold text-fg">{k}</dd>
                <dd className="mt-1 text-xs leading-snug text-subtle">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <DecisionPreview />
      </section>

      {/* How it works */}
      <section className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8" aria-labelledby="how">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand">How it works</p>
          <h2 id="how" className="mt-2 text-3xl font-semibold tracking-tight text-fg">AI proposes. The chain disposes.</h2>
        </div>
        <ol className="mt-10 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="rounded-[var(--radius-card)] border border-line bg-surface/70 p-6 transition-base hover:border-line-strong">
              <span className="font-mono text-sm text-brand">{s.n}</span>
              <h3 className="mt-3 text-lg font-semibold text-fg">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8" aria-labelledby="features">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-brand">Guarantees</p>
          <h2 id="features" className="mt-2 text-3xl font-semibold tracking-tight text-fg">Enforced by the program, not by a prompt</h2>
          <p className="mt-3 text-muted">Even if the backend or the model is compromised, the attacker can only do what the on-chain policy allows.</p>
        </div>
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-[var(--radius-card)] border border-line bg-surface/70 p-6 transition-base hover:-translate-y-0.5 hover:border-brand/30">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-elevated text-brand transition-base group-hover:shadow-[0_0_24px_-6px_rgb(20_241_149/0.6)]">
                {f.icon}
              </div>
              <h3 className="mt-4 font-semibold text-fg">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Evidence */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8" aria-labelledby="evidence">
        <div className="rounded-3xl border border-line bg-surface/70 p-6 sm:p-10">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 id="evidence" className="text-2xl font-semibold tracking-tight text-fg">Verified on devnet</h2>
              <p className="mt-2 max-w-xl text-sm text-muted">Every outcome below is a real Solana devnet transaction. Open any of them in Explorer.</p>
            </div>
          </div>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {EVIDENCE.map((e) => (
              <li key={e.sig}>
                <a
                  href={explorerTxUrl(e.sig)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="group flex items-center justify-between gap-3 rounded-xl border border-line bg-canvas/50 px-4 py-3 transition-base hover:border-line-strong hover:bg-elevated"
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2 text-sm font-medium text-fg">
                      {e.ok ? <IconCircleCheck size={16} className="text-brand" /> : <IconCircleX size={16} className="text-danger" />}
                      {e.label}
                    </span>
                    <span className="mt-1 block truncate font-mono text-xs text-subtle">
                      {e.sig.slice(0, 10)}…{e.sig.slice(-8)}
                    </span>
                  </span>
                  <IconExternal size={16} className="shrink-0 text-subtle transition-base group-hover:text-fg" />
                  <span className="sr-only">(opens Solana Explorer in a new tab)</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl border border-brand/25 bg-linear-to-br from-brand/12 via-surface to-accent/14 px-6 py-14 text-center sm:px-12">
          <h2 className="text-3xl font-semibold tracking-tight text-fg">Put your agent behind a firewall</h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">Connect a devnet wallet, create a policy in under a minute, and let the AI Playground try to spend from it.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink href="/policies/new" size="lg">
              Create a policy
            </ButtonLink>
            <ButtonLink href="/agent" size="lg" variant="secondary">
              Try the AI Playground
            </ButtonLink>
          </div>
        </div>
      </section>
    </main>
  );
}
