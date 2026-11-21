import { data, getInvoice } from "@/lib/engine";
import { score } from "@/lib/evaluate";
import { llmConfig, runAll } from "@/lib/llm";
import type { AgentVersion, Verdict } from "@/lib/types";


/** Runs both agent versions over the payment run and scores each against the answer key. Add ?engine=llm to score the LLM agent. */
export async function GET(req: Request) {
  const useLLM = new URL(req.url).searchParams.get("engine") === "llm" && !!llmConfig();
  const invoices = data.runOrder.map((id) => getInvoice(id)!);
  const reports = [];
  for (const version of ["v1", "v2"] as AgentVersion[]) {
    const verdicts: Verdict[] = [];
    for await (const v of runAll(invoices, version, useLLM)) verdicts.push(v);
    reports.push(score(version, useLLM ? "llm" : "rules", verdicts));
  }
  return Response.json({ reports, payments: invoices.length });
}
