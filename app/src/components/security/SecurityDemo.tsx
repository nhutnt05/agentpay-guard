"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { OutcomePanel } from "@/components/payments/OutcomePanel";
import { PolicyPicker } from "@/components/policy/PolicyPicker";
import { Address } from "@/components/ui/Address";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { IconBolt, IconPlay, IconShield } from "@/components/ui/icons";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { LoadingBlock } from "@/components/ui/Spinner";
import { type AnyData, createApiClient } from "@/lib/client/api";
import { reasonLabel } from "@/lib/demo/labels";
import { SCENARIO_ORDER, SCENARIOS, type ScenarioId, type ScenarioOutcome } from "@/lib/demo/scenarios";
import { AGENT_IS_MERCHANT_WARNING, agentIsAllowlistedMerchant } from "@/lib/policy/warnings";
import { formatBaseUnits, parseDecimalAmount } from "@/lib/solana/amounts";
import { cn } from "@/lib/ui/cn";

const api = createApiClient();

export function SecurityDemo() {
  const policyId = useSearchParams().get("policy")?.trim() ?? "";
  const [health, setHealth] = useState<AnyData | null>(null);
  const [policy, setPolicy] = useState<AnyData | null>(null);
  const [merchants, setMerchants] = useState<AnyData[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingPolicy, setLoadingPolicy] = useState(false);
  const [merchant, setMerchant] = useState("");
  const [attacker, setAttacker] = useState("");
  const [amountDecimal, setAmountDecimal] = useState("1");
  const [forceOnChain, setForceOnChain] = useState(false);
  const [agentMode, setAgentMode] = useState<"LLM" | "SCRIPTED">("SCRIPTED");
  const [running, setRunning] = useState<ScenarioId | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [results, setResults] = useState<Partial<Record<ScenarioId, ScenarioOutcome>>>({});

  async function load() {
    setLoadError(null);
    const h = await api.health();
    setHealth(h.data ?? null);
    if (!policyId) return;
    setLoadingPolicy(true);
    try {
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
    } finally {
      setLoadingPolicy(false);
    }
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
      const v = parseDecimalAmount(amountDecimal, decimals);
      return v > 0n ? v.toString() : null;
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
      await load();
    }
  }

  async function runAll() {
    setRunningAll(true);
    try {
      for (const id of SCENARIO_ORDER) {
        if (id === "PROMPT_INJECTION" && !demoEnabled) continue;
        await run(id);
      }
    } finally {
      setRunningAll(false);
    }
  }

  // Scenarios that need an owner step first (e.g. pause) are neither a pass nor a fail.
  const judged = Object.values(results).filter((r) => r && r.actual.status !== "NEEDS_OWNER_ACTION");
  const passed = judged.filter((r) => r?.matchesExpectation).length;
  const ran = judged.length;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Policy under test" description="Pick a policy served by this server's agent. Results come from real devnet reads." />
        <PolicyPicker current={policyId} />
      </Card>

      {loadError && <Alert tone="danger" title="Could not load policy">{loadError}</Alert>}
      {loadingPolicy && !policy && <LoadingBlock label="Reading policy from chain…" />}

      {!policyId && (
        <Card>
          <EmptyState
            icon={<IconShield size={24} />}
            title="Choose a policy to attack"
            description="Six scenarios try to make the agent overspend, pay an attacker, pay twice, or pay while paused. The program must refuse every one except the normal payment."
          />
        </Card>
      )}

      {policy && (
        <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Policy state">
            {[
              ["Vault", formatBaseUnits(BigInt(policy.vaultBalance ?? "0"), decimals)],
              [
                "Spent today",
                `${policy.derived?.effectiveSpentToday ? formatBaseUnits(BigInt(policy.derived.effectiveSpentToday), decimals) : "—"} / ${formatBaseUnits(BigInt(policy.dailyLimit), decimals)}`,
              ],
              ["Max per payment", formatBaseUnits(BigInt(policy.maxPerTx), decimals)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-xl border border-line bg-surface/70 px-4 py-3">
                <div className="text-xs text-subtle">{k}</div>
                <div className="mt-1 font-semibold tabular-nums text-fg">{v}</div>
              </div>
            ))}
            <div className="rounded-xl border border-line bg-surface/70 px-4 py-3">
              <div className="text-xs text-subtle">Status</div>
              <div className="mt-1">
                <Badge tone={policy.isPaused ? "warning" : "success"} dot>
                  {policy.isPaused ? "Paused" : "Active"}
                </Badge>
              </div>
            </div>
          </section>

          {agentIsAllowlistedMerchant(policy.agent, merchants.map((m) => m.merchant)) && (
            <Alert tone="warning" title="Configuration warning">{AGENT_IS_MERCHANT_WARNING}</Alert>
          )}
          {!policy.servedByThisAgent && (
            <Alert tone="info" title="This server's agent does not act for this policy">
              {reasonLabel(policy.accessReason) ?? policy.accessReason}. Payment scenarios will be refused before reaching the chain.
            </Alert>
          )}

          <Card>
            <CardHeader title="Scenario settings" />
            <div className="grid gap-4 md:grid-cols-2">
              <Select label="Allowlisted merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} className="font-mono">
                {merchants.length === 0 && <option value="">(no merchants allowlisted)</option>}
                {merchants.map((m) => (
                  <option key={m.merchant} value={m.merchant}>
                    {m.merchant}
                  </option>
                ))}
              </Select>
              <Input
                label="Non-allowlisted wallet (attacker)"
                value={attacker}
                onChange={(e) => setAttacker(e.target.value.trim())}
                className="font-mono"
                spellCheck={false}
                hint="Prompt-injection and unauthorized-merchant scenarios try to pay this wallet."
              />
              <Input
                label="Amount per payment"
                value={amountDecimal}
                onChange={(e) => setAmountDecimal(e.target.value.trim())}
                inputMode="decimal"
                suffix="tokens"
                error={amountUnits ? null : `Enter an amount greater than 0 (max ${decimals} decimals).`}
              />
              <Select
                label="Prompt-injection agent"
                value={agentMode}
                onChange={(e) => setAgentMode(e.target.value as "LLM" | "SCRIPTED")}
                hint="Scripted reproduces the manipulated output without an LLM call."
              >
                <option value="SCRIPTED">Scripted (no LLM cost)</option>
                <option value="LLM">Live LLM (billed)</option>
              </Select>
            </div>
            <label className={cn("mt-4 flex items-start gap-3 rounded-xl border border-line bg-canvas/40 p-3 text-sm", !demoEnabled && "opacity-60")}>
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-brand"
                checked={forceOnChain}
                disabled={!demoEnabled}
                onChange={(e) => setForceOnChain(e.target.checked)}
              />
              <span>
                <span className="font-medium text-fg">Submit failing transactions on-chain</span>
                <span className="block text-muted">
                  Costs a network fee but produces Explorer evidence. {demoEnabled ? "" : "Requires DEMO_MODE=true on the server."}
                </span>
              </span>
            </label>
          </Card>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-muted" aria-live="polite">
              {ran > 0 ? (
                <>
                  <span className={cn("font-semibold", passed === ran ? "text-brand" : "text-warning")}>
                    {passed}/{ran}
                  </span>{" "}
                  scenarios behaved as expected
                </>
              ) : (
                "Run scenarios one by one, or all in sequence."
              )}
            </div>
            <Button onClick={runAll} loading={runningAll} disabled={Boolean(running) || !amountUnits} icon={<IconBolt size={16} />}>
              Run all scenarios
            </Button>
          </div>

          <section className="grid gap-5 md:grid-cols-2">
            {SCENARIO_ORDER.map((id, i) => {
              const s = SCENARIOS[id];
              const needsDemo = id === "PROMPT_INJECTION" && !demoEnabled;
              const disabled = Boolean(running) || !amountUnits || needsDemo;
              const r = results[id];
              return (
                <Card
                  key={id}
                  as="article"
                  variant={
                    r && r.actual.status !== "NEEDS_OWNER_ACTION" ? (r.matchesExpectation ? "success" : "danger") : running === id ? "brand" : "default"
                  }
                  className="animate-fade-up"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-subtle">{String(i + 1).padStart(2, "0")}</span>
                        <h3 className="font-semibold text-fg">{s.title}</h3>
                      </div>
                      <p className="mt-1 text-sm text-muted">{s.description}</p>
                    </div>
                    <Button size="sm" variant={r ? "outline" : "secondary"} onClick={() => void run(id)} loading={running === id} disabled={disabled} icon={<IconPlay size={15} />}>
                      {r ? "Run again" : "Run"}
                    </Button>
                  </div>
                  {needsDemo && <p className="mt-2 text-xs text-subtle">Requires DEMO_MODE=true on the server.</p>}
                  {r && <OutcomePanel outcome={r} decimals={decimals} />}
                </Card>
              );
            })}
          </section>

          <p className="flex flex-wrap items-center gap-2 text-xs text-subtle">
            Agent <Address value={policy.agent} /> · policy <Address value={policy.address} />
          </p>
        </>
      )}
    </div>
  );
}
