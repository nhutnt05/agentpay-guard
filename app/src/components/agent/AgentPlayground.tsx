"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { PolicyPicker } from "@/components/policy/PolicyPicker";
import { Badge } from "@/components/ui/Badge";
import { ExplorerLink, short } from "@/components/ui/ExplorerLink";
import { type AnyData, type ApiResponse, createApiClient } from "@/lib/client/api";
import { evidenceLabel, reasonLabel, statusLabel } from "@/lib/demo/labels";
import { toAttempt } from "@/lib/demo/scenarios";
import { formatBaseUnits } from "@/lib/solana/amounts";

const api = createApiClient();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ResultLine({ res }: { res: ApiResponse<AnyData> }) {
  const a = toAttempt(res);
  const st = statusLabel(a.status);
  const ev = evidenceLabel(a.status, a.evidence);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Badge tone={st.tone}>{st.label}</Badge>
      {ev && <Badge tone="neutral">{ev}</Badge>}
      {a.reason && <span>{reasonLabel(a.reason)}</span>}
      {a.signature && <ExplorerLink href={a.explorerUrl} label={short(a.signature)} />}
      {a.message && <span className="text-zinc-600 dark:text-zinc-400">{a.message}</span>}
    </div>
  );
}

export function AgentPlayground() {
  const policyId = useSearchParams().get("policy")?.trim() ?? "";
  const [demoEnabled, setDemoEnabled] = useState(false);
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
    void api.health().then((h) => setDemoEnabled(Boolean(h.data?.demo?.enabled)));
  }, []);

  async function analyze() {
    setBusy("analyze");
    setAnalysis(null);
    setPrepared(null);
    setSubmitted(null);
    try {
      setAnalysis(
        await api.analyze({
          policy: policyId,
          userInstruction: instruction,
          mode,
          ...(source === "url" ? { url } : { text }),
        }),
      );
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
  const decimals = 6;

  return (
    <div className="space-y-6">
      <PolicyPicker current={policyId} />

      <section className="space-y-3 rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
        <div className="flex gap-4">
          <label className="flex items-center gap-1">
            <input type="radio" checked={source === "text"} onChange={() => setSource("text")} /> Text
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={source === "url"} onChange={() => setSource("url")} /> URL (Firecrawl)
          </label>
        </div>
        {source === "url" ? (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… (must be publicly reachable)"
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
          />
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            placeholder="Page content the agent should read"
            className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 font-mono dark:border-zinc-700 dark:bg-zinc-900"
          />
        )}
        <input
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          className="w-full rounded border border-zinc-300 bg-white px-2 py-1.5 dark:border-zinc-700 dark:bg-zinc-900"
          aria-label="Instruction"
        />
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "SAFE" | "VULNERABLE_DEMO")}
            className="rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          >
            <option value="SAFE">Hardened prompt</option>
            <option value="VULNERABLE_DEMO" disabled={!demoEnabled}>
              Intentionally vulnerable agent (demo{demoEnabled ? "" : " — requires DEMO_MODE"})
            </option>
          </select>
          <button
            onClick={analyze}
            disabled={!policyId || Boolean(busy)}
            className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy === "analyze" ? "Analyzing…" : "Analyze (calls the LLM — billed)"}
          </button>
        </div>
      </section>

      {analysis && !analysis.ok && (
        <p className="text-sm text-red-700 dark:text-red-400">
          {analysis.error?.code}: {analysis.error?.message}
        </p>
      )}

      {a && (
        <section className="space-y-3 rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
          <div className="flex flex-wrap gap-2">
            <Badge tone="info">Agent proposal (untrusted)</Badge>
            <Badge tone="neutral">model {a.llm?.model}{a.llm?.fallbackUsed ? " (fallback)" : ""}</Badge>
            <Badge tone="neutral">{a.contentSource === "FIRECRAWL" ? "live scrape" : "text input"}{a.contentTruncated ? " · truncated" : ""}</Badge>
            {a.mode === "VULNERABLE_DEMO" && <Badge tone="warning">Intentionally vulnerable agent configuration (demo)</Badge>}
          </div>
          <details>
            <summary className="cursor-pointer">Content the agent read</summary>
            <pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">{a.contentPreview}</pre>
          </details>
          <div>
            <div className="font-medium">LLM output</div>
            <pre className="mt-1 overflow-auto whitespace-pre-wrap rounded bg-zinc-50 p-2 text-xs dark:bg-zinc-900">{JSON.stringify(a.proposal, null, 2)}</pre>
          </div>
          {a.intentValid && a.intent ? (
            <p>
              Intent: pay <span className="font-mono">{short(a.intent.merchant)}</span> {formatBaseUnits(BigInt(a.intent.amount), decimals)} tokens
            </p>
          ) : (
            <p className="text-amber-700 dark:text-amber-400">No valid payment intent: {(a.issues as string[]).join("; ")}</p>
          )}
          <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
            {(a.warnings as string[]).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
          {a.intentValid && (
            <button
              onClick={prepare}
              disabled={Boolean(busy)}
              className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy === "prepare" ? "Preparing…" : "Prepare (simulate)"}
            </button>
          )}
        </section>
      )}

      {prepared && (
        <section className="space-y-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <ResultLine res={prepared} />
          {prepared.data?.status === "READY_TO_SIGN" && (
            <button
              onClick={submit}
              disabled={Boolean(busy)}
              className="rounded bg-zinc-900 px-3 py-1.5 text-sm text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
            >
              {busy === "submit" ? "Submitting…" : "Submit (agent signs)"}
            </button>
          )}
        </section>
      )}

      {submitted && (
        <section className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <ResultLine res={submitted} />
        </section>
      )}

      {!policyId && <p className="text-sm text-zinc-600">Enter a policy address to use the agent.</p>}
    </div>
  );
}
