// Every investigation and chat turn passes through here on its way to PRISM.
// PRISM has no npm SDK; TypeScript apps POST one trace per exchange to /api/traces
// (docs: blockconvey.com/docs, "Create a Trace" and "TypeScript and JavaScript").
import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { getVendor } from "./engine";
import type { Invoice, Verdict } from "./types";

export type LLMUsage = { model: string; messages: { role: string; content?: string | null }[]; output: string; tokensIn: number; tokensOut: number; ms: number };

export const prismConfig = () => {
  const key = process.env.PRISMTRACE_API_KEY;
  const project = process.env.PRISMTRACE_PROJECT_ID;
  const host = (process.env.PRISMTRACE_HOST ?? "https://api.prism.blockconvey.com").replace(/\/+$/, "");
  return key && project ? { key, project, host } : null;
};

/** Fire-and-forget POST of one trace. Never throws and never blocks the caller. */
export function sendToPrism(trace: Record<string, unknown>) {
  const cfg = prismConfig();
  if (!cfg) return;
  fetch(`${cfg.host}/api/traces`, {
    method: "POST",
    headers: { "content-type": "application/json", "X-PRISMtrace-Key": cfg.key },
    body: JSON.stringify({ project_id: cfg.project, trace_id: randomUUID(), ...trace }),
    signal: AbortSignal.timeout(5000),
  })
    .then(async (r) => {
      if (!r.ok) console.warn(`[prism] trace rejected ${r.status}: ${(await r.text()).slice(0, 200)}`);
    })
    .catch((e) => console.warn(`[prism] trace not sent: ${e instanceof Error ? e.message : e}`));
}

/** Record one payment investigation. `session` groups a payment run; without it nothing goes to PRISM. */
export function exportTrace(verdict: Verdict, inv: Invoice, session?: string, llm?: LLMUsage) {
  const vendor = getVendor(inv.vendorId);
  const summary = { decision: verdict.decision, problems: verdict.signals.map((s) => ({ rule: s.rule, detail: s.detail, at_risk: s.exposure })), rationale: verdict.rationale };
  const meta = {
    invoice_id: inv.id, invoice_number: inv.invoiceNumber, vendor: vendor.name, amount: inv.amount,
    decision: verdict.decision, rules: verdict.signals.map((s) => s.rule), exposure: verdict.exposure,
    agent_version: verdict.version, engine: verdict.engine,
    overruled: verdict.spans.some((s) => s.name === "model_overruled"),
    spans: verdict.spans.map(({ id, type, name, output, ms, flagged, error }) => ({ id, type, name, output, ms, flagged, error })),
  };

  if (session)
    sendToPrism({
      session_id: session,
      agent_id: `holdline-payment-check-${verdict.version}`,
      agent_name: `Holdline payment check ${verdict.version}`,
      model: llm?.model ?? "holdline-rules-engine",
      input_messages: (llm?.messages ?? [{ role: "user", content: `Check payment ${inv.invoiceNumber} from ${vendor.name} for ${inv.amount}` }])
        .filter((m) => typeof m.content === "string" && m.content)
        .map((m) => ({ role: m.role, content: m.content })),
      output_message: llm?.output ?? JSON.stringify(summary),
      latency_ms: Math.round(llm?.ms ?? verdict.spans.reduce((a, s) => a + s.ms, 0)),
      ...(llm ? { token_count_input: llm.tokensIn, token_count_output: llm.tokensOut } : {}),
      metadata: meta,
    });

  const file = process.env.TRACE_FILE; // e.g. TRACE_FILE=traces.jsonl for a local copy
  if (file) appendFile(file, JSON.stringify({ ts: new Date().toISOString(), session, ...meta }) + "\n").catch(() => {});
}
