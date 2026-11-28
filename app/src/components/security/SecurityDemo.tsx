"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OutcomePanel } from "@/components/payments/OutcomePanel";
import { PolicyPicker } from "@/components/policy/PolicyPicker";
import { Badge } from "@/components/ui/Badge";
import { short } from "@/components/ui/ExplorerLink";
import { type AnyData, createApiClient } from "@/lib/client/api";
import { reasonLabel } from "@/lib/demo/labels";
import { AGENT_IS_MERCHANT_WARNING, agentIsAllowlistedMerchant } from "@/lib/policy/warnings";
import { SCENARIO_ORDER, SCENARIOS, type ScenarioId, type ScenarioOutcome } from "@/lib/demo/scenarios";
import { formatBaseUnits, parseDecimalAmount } from "@/lib/solana/amounts";

const api = createApiClient();

export function SecurityDemo() {
  const policyId = useSearchParams().get("policy")?.trim() ?? "";
  const [health, setHealth] = useState<AnyData | null>(null);
  const [policy, setPolicy] = useState<AnyData | null>(null);
  const [merchants, setMerchants] = useState<AnyData[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [merchant, setMerchant] = useState("");
  const [attacker, setAttacker] = useState("");
  const [amountDecimal, setAmountDecimal] = useState("1");
  const [forceOnChain, setForceOnChain] = useState(false);
  const [agentMode, setAgentMode] = useState<"LLM" | "SCRIPTED">("SCRIPTED");
  const [running, setRunning] = useState<ScenarioId | null>(null);
  const [results, setResults] = useState<Partial<Record<ScenarioId, ScenarioOutcome>>>({});

  async function load() {
    setLoadError(null);
    const h = await api.health();
    setHealth(h.data ?? null);
    if (!policyId) return;
    const [p, m] = await Promise.all([api.policy(policyId), api.merchants(policyId)]);
    if (!p.ok) {
      setPolicy(null);
      setLoadError(`${p.error?.code}: ${p.error?.message}`);
      return;
    }
    setPolicy(p.data ?? null);
    const list = (m.data?.merchants as AnyData[] | undefined) ?? [];
    setMerchants(list);
    const demoMerchant = h.data?.demo?.merchantWallet as string | null;
    setMerchant((cur) => cur || (list.find((x) => x.merchant === demoMerchant)?.merchant ?? list[0]?.merchant ?? ""));
    setAttacker((cur) => cur || ((h.data?.demo?.attackerWallet as string | null) ?? ""));
  }

  useEffect(() => {
    // Load server config + on-chain policy whenever the selected policy changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyId]);

  const decimals: number = policy?.decimals ?? 6;
  const amountUnits = useMemo(() => {
    try {
      return parseDecimalAmount(amountDecimal, decimals).toString();
    } catch {
      return null;
    }
  }, [amountDecimal, decimals]);
  const demoEnabled = Boolean(health?.demo?.enabled);

  async function run(id: ScenarioId) {
    if (!policy || !amountUnits) return;
    setRunning(id);
    try {
      const outcome = await SCENARIOS[id].run({
        api,
        policy: policyId,
        merchant,
        attacker,
        amount: amountUnits,
        maxPerTx: policy.maxPerTx,
        forceOnChain: forceOnChain && demoEnabled,
        agentMode,
      });
      setResults((r) => ({ ...r, [id]: outcome }));
    } finally {
      setRunning(null);
      void load();
    }
  }

  return (
    <div className="space-y-6">
      <PolicyPicker current={policyId} />
      {loadError && <p className="text-sm text-red-700 dark:text-red-400">{loadError}</p>}

      {policy && (
        <section className="grid gap-3 rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800 sm:grid-cols-2">
          <div>Policy: <span className="font-mono">{short(policy.address)}</span></div>
          <div>Agent: <span className="font-mono">{short(policy.agent)}</span></div>
          <div>Vault: {formatBaseUnits(BigInt(policy.vaultBalance ?? "0"), decimals)}</div>
          <div>
            Spent today (derived): {policy.derived?.effectiveSpentToday ? formatBaseUnits(BigInt(policy.derived.effectiveSpentToday), decimals) : "—"}
            {" / "}
            {formatBaseUnits(BigInt(policy.dailyLimit), decimals)}
          </div>
          <div>Max per tx: {formatBaseUnits(BigInt(policy.maxPerTx), decimals)}</div>
          <div className="flex items-center gap-2">
            Status: {policy.isPaused ? <Badge tone="warning">Paused</Badge> : <Badge tone="success">Active</Badge>}
          </div>
          {agentIsAllowlistedMerchant(policy.agent, merchants.map((m) => m.merchant)) && (
            <p className="rounded border border-red-300 bg-red-50 p-2 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200 sm:col-span-2">
              ⚠ {AGENT_IS_MERCHANT_WARNING}
            </p>
          )}
          {!policy.servedByThisAgent && (
            <p className="text-amber-700 dark:text-amber-400 sm:col-span-2">
              This server&apos;s agent does not act for this policy ({reasonLabel(policy.accessReason) ?? policy.accessReason}); payment
              scenarios will be refused before reaching the chain.
            </p>
          )}
        </section>
      )}

      {policy && (
        <section className="grid gap-3 text-sm sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            Allowlisted merchant
            <select
              value={merchant}
              onChange={(e) => setMerchant(e.target.value)}
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
            >
              {merchants.length === 0 && <option value="">(no merchants allowlisted)</option>}
              {merchants.map((m) => (
                <option key={m.merchant} value={m.merchant}>
                  {m.merchant}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            Non-allowlisted wallet (attacker)
            <input
              value={attacker}
              onChange={(e) => setAttacker(e.target.value.trim())}
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
              spellCheck={false}
            />
          </label>
          <label className="flex flex-col gap-1">
            Amount (tokens)
            <input
              value={amountDecimal}
              onChange={(e) => setAmountDecimal(e.target.value.trim())}
              inputMode="decimal"
              className="rounded border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {!amountUnits && <span className="text-red-700">invalid amount for {decimals} decimals</span>}
          </label>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={forceOnChain} disabled={!demoEnabled} onChange={(e) => setForceOnChain(e.target.checked)} />
              Submit failing transactions on-chain (costs a fee, produces Explorer evidence)
            </label>
            {!demoEnabled && <span className="text-xs text-zinc-500">Requires DEMO_MODE=true on the server.</span>}
            <label className="flex items-center gap-2">
              Prompt-injection agent:
              <select
                value={agentMode}
                onChange={(e) => setAgentMode(e.target.value as "LLM" | "SCRIPTED")}
                className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="SCRIPTED">Scripted (no LLM cost)</option>
                <option value="LLM">Live LLM (billed)</option>
              </select>
            </label>
          </div>
        </section>
      )}

      {policy && (
        <section className="grid gap-4 md:grid-cols-2">
          {SCENARIO_ORDER.map((id) => {
            const s = SCENARIOS[id];
            const disabled = Boolean(running) || !amountUnits || (id === "PROMPT_INJECTION" && !demoEnabled);
            return (
              <article key={id} className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{s.title}</h3>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.description}</p>
                  </div>
                  <button
                    onClick={() => run(id)}
                    disabled={disabled}
                    className="shrink-0 rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
                  >
                    {running === id ? "Running…" : "Run"}
                  </button>
                </div>
                {id === "PROMPT_INJECTION" && !demoEnabled && (
                  <p className="mt-2 text-xs text-zinc-500">Requires DEMO_MODE=true on the server.</p>
                )}
                {results[id] && <OutcomePanel outcome={results[id]!} decimals={decimals} />}
              </article>
            );
          })}
        </section>
      )}

      {!policyId && <p className="text-sm text-zinc-600">Enter a policy address to run the scenarios.</p>}
    </div>
  );
}
