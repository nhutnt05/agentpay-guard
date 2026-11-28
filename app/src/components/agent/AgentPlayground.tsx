"use client";

import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { PolicyPicker } from "@/components/policy/PolicyPicker";
import { Address } from "@/components/ui/Address";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
import { Button, ButtonLink } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { IconBot, IconBolt, IconShield } from "@/components/ui/icons";
import { Input, TextArea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { type AnyData, type ApiResponse, createApiClient } from "@/lib/client/api";
import { evidenceLabel, reasonLabel, statusLabel } from "@/lib/demo/labels";
import { toAttempt } from "@/lib/demo/scenarios";
import { formatBaseUnits } from "@/lib/solana/amounts";
import { cn } from "@/lib/ui/cn";

const api = createApiClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function Step({ n, title, description, done, active, children }: { n: number; title: string; description?: string; done?: boolean; active?: boolean; children: ReactNode }) {
  return (
    <li className="relative pl-12 animate-fade-up">
      <span
        className={cn(
          "absolute left-0 top-0 flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold",
          done ? "border-brand/50 bg-brand/15 text-brand" : active ? "border-brand bg-brand text-brand-ink" : "border-line-strong bg-elevated text-muted",
        )}
      >
        {n}
      </span>
      <div className="mb-3">
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {children}
    </li>
  );
}

function Outcome({ res }: { res: ApiResponse<AnyData> }) {
  const a = toAttempt(res);
  const st = statusLabel(a.status);
  const ev = evidenceLabel(a.status, a.evidence);
  const tone = st.tone === "success" ? "success" : st.tone === "warning" ? "warning" : st.tone === "danger" ? "danger" : "info";
  return (
    <Alert tone={tone} title={st.label}>
      <span className="flex flex-wrap items-center gap-2">
        {ev && <Badge tone="neutral">{ev}</Badge>}
        {a.reason && <span className="text-fg">{reasonLabel(a.reason)}</span>}
        {a.signature && <Address value={a.signature} kind="tx" />}
      </span>
      {a.message && <span className="mt-1 block">{a.message}</span>}
    </Alert>
  );
}

export function AgentPlayground() {
  const policyId = useSearchParams().get("policy")?.trim() ?? "";
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [demoMerchant, setDemoMerchant] = useState<string | null>(null);
  const [decimals, setDecimals] = useState(6);
  const [source, setSource] = useState<"url" | "text">("text");
  const [url, setUrl] = useState("");
  const [text, setText] = useState("");
  const [instruction, setInstruction] = useState("Buy the Starter plan.");
  const [mode, setMode] = useState<"SAFE" | "VULNERABLE_DEMO">("SAFE");
  const [busy, setBusy] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<ApiResponse<AnyData> | null>(null);
  const [prepared, setPrepared] = useState<ApiResponse<AnyData> | null>(null);
  const [submitted, setSubmitted] = useState<ApiResponse<AnyData> | null>(null);

  useEffect(() => {
    void api.health().then((h) => {
      setDemoEnabled(Boolean(h.data?.demo?.enabled));
      setDemoMerchant((h.data?.demo?.merchantWallet as string | null) ?? null);
    });
  }, []);

  useEffect(() => {
    if (!policyId) return;
    void api.policy(policyId).then((p) => {
      if (p.ok && typeof p.data?.decimals === "number") setDecimals(p.data.decimals);
    });
  }, [policyId]);

  async function analyze() {
    setBusy("analyze");
    setAnalysis(null);
    setPrepared(null);
    setSubmitted(null);
    try {
      setAnalysis(await api.analyze({ policy: policyId, userInstruction: instruction, mode, ...(source === "url" ? { url } : { text }) }));
    } finally {
      setBusy(null);
    }
  }

  async function prepare() {
    const intent = analysis?.data?.intent;
    if (!intent) return;
    setBusy("prepare");
    setSubmitted(null);
    try {
      setPrepared(await api.prepare({ policy: policyId, merchant: intent.merchant, amount: intent.amount }));
    } finally {
      setBusy(null);
    }
  }

  async function submit() {
    const p = prepared?.data?.preparedPayment;
    if (!p) return;
    setBusy("submit");
    try {
      let res = await api.submit({
        policy: p.policy,
        merchant: p.merchant,
        amount: p.amount,
        requestId: p.requestId,
        expiresAt: p.expiresAt,
        requestHash: p.requestHash,
      });
      setSubmitted(res);
      // SUBMITTED → poll the authoritative status (max ~60 s).
      for (let i = 0; i < 30 && res.data?.status === "SUBMITTED" && res.data?.signature; i++) {
        await sleep(2_000);
        const s = await api.paymentStatus(res.data.signature);
        if (s.ok && s.data && s.data.status !== "SUBMITTED") {
          res = { ...res, data: { ...res.data, status: s.data.status, reason: s.data.error?.reason ?? null } };
          setSubmitted(res);
        }
      }
    } finally {
      setBusy(null);
    }
  }

  const a = analysis?.data;
  const contentReady = source === "url" ? /^https?:\/\//.test(url.trim()) : text.trim().length > 0;
  const canAnalyze = Boolean(policyId) && contentReady && instruction.trim().length > 0 && !busy;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
      <ol className="space-y-10">
        <Step n={1} title="Choose a policy" description="The agent can only spend from this policy's vault, within its rules." done={Boolean(policyId)} active={!policyId}>
          <Card>
            <PolicyPicker current={policyId} />
          </Card>
        </Step>

        <Step n={2} title="Give the agent something to read" description="A pricing page or an invoice. The agent turns it into a payment proposal." done={Boolean(a)} active={Boolean(policyId) && !a}>
          <Card className="space-y-4">
            <div className="inline-flex rounded-xl border border-line bg-canvas/60 p-1" role="radiogroup" aria-label="Content source">
              {(["text", "url"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  role="radio"
                  aria-checked={source === s}
                  onClick={() => setSource(s)}
                  className={cn(
                    "rounded-lg px-3.5 py-1.5 text-sm font-medium transition-base",
                    source === s ? "bg-elevated text-fg shadow-sm" : "text-muted hover:text-fg",
                  )}
                >
                  {s === "text" ? "Paste text" : "Scrape a URL"}
                </button>
              ))}
            </div>
            {source === "url" ? (
              <Input label="Page URL" placeholder="https://… (must be publicly reachable)" value={url} onChange={(e) => setUrl(e.target.value)} hint="Fetched with Firecrawl on the server." />
            ) : (
              <TextArea
                label="Page content"
                rows={7}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Paste the content the agent should read…"
                className="font-mono text-[13px]"
              />
            )}
            {source === "text" && demoMerchant && !text && (
              <button
                type="button"
                className="text-xs font-medium text-brand hover:text-brand-strong"
                onClick={() =>
                  setText(`Acme Data API — Invoice\n\nStarter plan: 1 tUSDC per month.\nPay to wallet: ${demoMerchant}\nThank you for your business.`)
                }
              >
                Insert a sample invoice (demo merchant)
              </button>
            )}
            <Input label="Instruction to the agent" value={instruction} onChange={(e) => setInstruction(e.target.value)} />
            <Select label="Agent configuration" value={mode} onChange={(e) => setMode(e.target.value as "SAFE" | "VULNERABLE_DEMO")}>
              <option value="SAFE">Hardened prompt</option>
              <option value="VULNERABLE_DEMO" disabled={!demoEnabled}>
                Intentionally vulnerable agent {demoEnabled ? "(demo)" : "(requires DEMO_MODE)"}
              </option>
            </Select>
            <div className="flex flex-wrap items-center gap-3 pt-1">
              <Button onClick={analyze} loading={busy === "analyze"} disabled={!canAnalyze} icon={<IconBot size={16} />}>
                {busy === "analyze" ? "Agent is reading…" : "Ask the agent"}
              </Button>
              <span className="text-xs text-subtle">Calls the LLM (billed to the server&apos;s API key).</span>
            </div>
            {!policyId && <p className="text-xs text-subtle">Choose a policy first.</p>}
          </Card>
          {analysis && !analysis.ok && (
            <Alert tone="danger" title="The agent could not analyze this" className="mt-4">
              {analysis.error?.code}: {analysis.error?.message}
            </Alert>
          )}
        </Step>

        {a && (
          <Step n={3} title="Review the agent's proposal" description="This output is untrusted. Nothing is paid yet." done={Boolean(prepared)} active={!prepared}>
            <Card className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Badge tone="info">Agent proposal (untrusted)</Badge>
                <Badge tone="neutral">
                  model {a.llm?.model}
                  {a.llm?.fallbackUsed ? " (fallback)" : ""}
                </Badge>
                <Badge tone="neutral">
                  {a.contentSource === "FIRECRAWL" ? "live scrape" : "text input"}
                  {a.contentTruncated ? " · truncated" : ""}
                </Badge>
                {a.mode === "VULNERABLE_DEMO" && <Badge tone="warning">Vulnerable agent (demo)</Badge>}
              </div>

              {a.intentValid && a.intent ? (
                <div className="rounded-xl border border-line bg-canvas/50 p-4">
                  <div className="text-xs font-medium uppercase tracking-wider text-subtle">Proposed payment</div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <span className="text-2xl font-semibold tabular-nums text-fg">{formatBaseUnits(BigInt(a.intent.amount), decimals)}</span>
                    <span className="text-muted">tokens to</span>
                    <Address value={a.intent.merchant} />
                  </div>
                </div>
              ) : (
                <Alert tone="warning" title="No valid payment intent">
                  {(a.issues as string[]).join("; ")}
                </Alert>
              )}

              {(a.warnings as string[]).length > 0 && (
                <ul className="space-y-1 text-sm text-muted">
                  {(a.warnings as string[]).map((w) => (
                    <li key={w} className="flex gap-2">
                      <span className="text-warning" aria-hidden="true">•</span>
                      {w}
                    </li>
                  ))}
                </ul>
              )}

              <details className="group rounded-xl border border-line bg-canvas/40">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-muted transition-base hover:text-fg">Content the agent read</summary>
                <pre className="max-h-60 overflow-auto whitespace-pre-wrap border-t border-line px-4 py-3 font-mono text-xs text-muted">{a.contentPreview}</pre>
              </details>
              <details className="rounded-xl border border-line bg-canvas/40">
                <summary className="cursor-pointer select-none px-4 py-2.5 text-sm font-medium text-muted transition-base hover:text-fg">Raw LLM output</summary>
                <pre className="overflow-auto whitespace-pre-wrap border-t border-line px-4 py-3 font-mono text-xs text-muted">{JSON.stringify(a.proposal, null, 2)}</pre>
              </details>

              {a.intentValid && (
                <Button onClick={prepare} loading={busy === "prepare"} disabled={Boolean(busy)} variant="secondary" icon={<IconShield size={16} />}>
                  Check against the policy (simulate)
                </Button>
              )}
            </Card>
          </Step>
        )}

        {prepared && (
          <Step n={4} title="Policy check" description="The server simulates execute_payment against the chain — no signature yet." done={Boolean(submitted)} active={!submitted}>
            <div className="space-y-4">
              <Outcome res={prepared} />
              {prepared.data?.status === "READY_TO_SIGN" && (
                <Button onClick={submit} loading={busy === "submit"} disabled={Boolean(busy)} icon={<IconBolt size={16} />}>
                  {busy === "submit" ? "Agent is signing…" : "Let the agent pay"}
                </Button>
              )}
            </div>
          </Step>
        )}

        {submitted && (
          <Step n={5} title="On-chain result" description="Confirmed only when the transaction landed and its receipt exists." done={submitted.data?.status === "CONFIRMED"}>
            <Outcome res={submitted} />
          </Step>
        )}
      </ol>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <Card className="bg-elevated/60">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
            <IconShield size={16} className="text-brand" /> Why this is safe
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            The model can be tricked — that is expected. Whatever it proposes, the Solana program only pays allowlisted merchants within the
            policy&apos;s limits, exactly once per request.
          </p>
        </Card>
        <Card className="bg-elevated/60">
          <h2 className="text-sm font-semibold text-fg">Want to see it fail?</h2>
          <p className="mt-2 text-sm text-muted">The Security Demo runs prompt injection, over-limit, duplicate and paused scenarios against real devnet.</p>
          <ButtonLink href={policyId ? `/security?policy=${policyId}` : "/security"} variant="secondary" size="sm" className="mt-3">
            Open Security Demo
          </ButtonLink>
        </Card>
      </aside>
    </div>
  );
}
