import { Badge } from "@/components/ui/Badge";
import { ExplorerLink, short } from "@/components/ui/ExplorerLink";
import { evidenceLabel, reasonLabel, statusLabel } from "@/lib/demo/labels";
import type { PolicySnapshot, ScenarioOutcome } from "@/lib/demo/scenarios";
import { formatBaseUnits } from "@/lib/solana/amounts";

function fmt(units: string | null | undefined, decimals: number): string {
  if (units === null || units === undefined) return "—";
  try {
    return formatBaseUnits(BigInt(units), decimals);
  } catch {
    return units;
  }
}

function Snapshot({ label, s, decimals }: { label: string; s: PolicySnapshot | null; decimals: number }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-sm">vault {fmt(s?.vaultBalance, decimals)} · spent today {fmt(s?.spentTodayEffective, decimals)}</div>
    </div>
  );
}

/** Result of one scenario: expected vs actual, evidence type, on-chain before/after. */
export function OutcomePanel({ outcome, decimals }: { outcome: ScenarioOutcome; decimals: number }) {
  const { actual, expected } = outcome;
  const st = statusLabel(actual.status);
  const ev = evidenceLabel(actual.status, actual.evidence);
  return (
    <div className="mt-3 space-y-2 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone}>{st.label}</Badge>
        {ev && <Badge tone="neutral">{ev}</Badge>}
        {actual.reason && <span className="font-medium">{reasonLabel(actual.reason)}</span>}
      </div>
      {actual.message && <p className="text-zinc-600 dark:text-zinc-400">{actual.message}</p>}
      {outcome.extra?.agent && (
        <div className="space-y-1 rounded bg-zinc-50 p-2 dark:bg-zinc-900">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning">{outcome.extra.agent.label}</Badge>
            <Badge tone="neutral">
              Agent output: {outcome.extra.agent.agentOutputSource === "LLM" ? `LLM (${outcome.extra.agent.llmModel})` : "SCRIPTED"}
            </Badge>
            {outcome.extra.contentLabel && <Badge tone="neutral">{outcome.extra.contentLabel}</Badge>}
          </div>
          {outcome.extra.agent.llmNote && <p className="text-xs text-zinc-600 dark:text-zinc-400">{outcome.extra.agent.llmNote}</p>}
          {outcome.extra.intent && (
            <p>
              Agent tried to pay <span className="font-mono">{short(outcome.extra.intent.merchant)}</span>{" "}
              {fmt(outcome.extra.intent.amount, decimals)} tokens.
            </p>
          )}
          <p>
            {outcome.extra.unchanged ? "Balances unchanged (on-chain before = after)" : "Balances changed"} ·{" "}
            {outcome.extra.receiptExists ? "receipt created" : "no receipt created"}
          </p>
        </div>
      )}
      {actual.signature && (
        <p>
          Signature: <ExplorerLink href={actual.explorerUrl} label={short(actual.signature)} />
        </p>
      )}
      {actual.status !== "NEEDS_OWNER_ACTION" && (
        <p className={outcome.matchesExpectation ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}>
          {outcome.matchesExpectation ? "✓ Firewall behaved as expected" : "✗ Unexpected result"} (expected{" "}
          {statusLabel(expected.status).label}
          {expected.reason ? ` · ${reasonLabel(expected.reason)}` : ""})
        </p>
      )}
      {(outcome.before || outcome.after) && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Snapshot label="Before (on-chain)" s={outcome.before} decimals={decimals} />
          <Snapshot label="After (on-chain)" s={outcome.after} decimals={decimals} />
        </div>
      )}
      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer">Steps</summary>
        <ol className="ml-4 list-decimal">
          {outcome.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
