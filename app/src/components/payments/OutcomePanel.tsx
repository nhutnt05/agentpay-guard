import { Address } from "@/components/ui/Address";
import { Badge } from "@/components/ui/Badge";
import { short } from "@/components/ui/ExplorerLink";
import { IconCircleCheck, IconCircleX } from "@/components/ui/icons";
import { evidenceLabel, reasonLabel, statusLabel } from "@/lib/demo/labels";
import type { PolicySnapshot, ScenarioOutcome } from "@/lib/demo/scenarios";
import { formatBaseUnits } from "@/lib/solana/amounts";
import { cn } from "@/lib/ui/cn";

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
    <div className="rounded-lg border border-line bg-canvas/40 px-3 py-2">
      <div className="text-[11px] font-medium uppercase tracking-wider text-subtle">{label}</div>
      <div className="mt-1 text-sm tabular-nums text-fg">
        vault {fmt(s?.vaultBalance, decimals)} <span className="text-subtle">·</span> spent {fmt(s?.spentTodayEffective, decimals)}
      </div>
    </div>
  );
}

/** Result of one scenario: expected vs actual, evidence type, on-chain before/after. */
export function OutcomePanel({ outcome, decimals }: { outcome: ScenarioOutcome; decimals: number }) {
  const { actual, expected } = outcome;
  const st = statusLabel(actual.status);
  const ev = evidenceLabel(actual.status, actual.evidence);
  const checked = actual.status !== "NEEDS_OWNER_ACTION";
  return (
    <div className="mt-4 space-y-3 border-t border-line pt-4 text-sm animate-fade-up">
      {checked && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-lg px-3 py-2",
            outcome.matchesExpectation ? "bg-brand/8 text-fg" : "bg-danger/8 text-fg",
          )}
        >
          {outcome.matchesExpectation ? <IconCircleCheck size={18} className="mt-px shrink-0 text-brand" /> : <IconCircleX size={18} className="mt-px shrink-0 text-danger" />}
          <span>
            <span className="font-semibold">{outcome.matchesExpectation ? "Firewall behaved as expected" : "Unexpected result"}</span>
            <span className="text-muted">
              {" "}
              — expected {statusLabel(expected.status).label.toLowerCase()}
              {expected.reason ? ` (${reasonLabel(expected.reason)})` : ""}
            </span>
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone}>{st.label}</Badge>
        {ev && <Badge tone="neutral">{ev}</Badge>}
        {actual.reason && <span className="font-medium text-fg">{reasonLabel(actual.reason)}</span>}
      </div>
      {actual.message && <p className="text-muted">{actual.message}</p>}

      {outcome.extra?.agent && (
        <div className="space-y-2 rounded-lg border border-line bg-canvas/40 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="warning">{outcome.extra.agent.label}</Badge>
            <Badge tone="neutral">
              Agent output: {outcome.extra.agent.agentOutputSource === "LLM" ? `LLM (${outcome.extra.agent.llmModel})` : "scripted"}
            </Badge>
            {outcome.extra.contentLabel && <Badge tone="neutral">{outcome.extra.contentLabel}</Badge>}
          </div>
          {outcome.extra.agent.llmNote && <p className="text-xs text-muted">{outcome.extra.agent.llmNote}</p>}
          {outcome.extra.intent && (
            <p className="text-muted">
              The agent tried to pay <span className="font-mono text-fg">{short(outcome.extra.intent.merchant)}</span>{" "}
              <span className="text-fg">{fmt(outcome.extra.intent.amount, decimals)}</span> tokens.
            </p>
          )}
          <p className="text-muted">
            {outcome.extra.unchanged ? "Balances unchanged (on-chain before = after)" : "Balances changed"} ·{" "}
            {outcome.extra.receiptExists ? "receipt created" : "no receipt created"}
          </p>
        </div>
      )}

      {actual.signature && (
        <div className="flex flex-wrap items-center gap-2 text-muted">
          Transaction <Address value={actual.signature} kind="tx" />
        </div>
      )}

      {(outcome.before || outcome.after) && (
        <div className="grid gap-2 sm:grid-cols-2">
          <Snapshot label="Before (on-chain)" s={outcome.before} decimals={decimals} />
          <Snapshot label="After (on-chain)" s={outcome.after} decimals={decimals} />
        </div>
      )}

      <details className="text-xs text-subtle">
        <summary className="cursor-pointer select-none transition-base hover:text-fg">Steps taken</summary>
        <ol className="ml-4 mt-2 list-decimal space-y-1">
          {outcome.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      </details>
    </div>
  );
}
