import labelsRaw from "@/data/labels.json";
import { getInvoice, getVendor } from "./engine";
import type { AgentVersion, EvalReport, Rule, Verdict } from "./types";

type Label = { invoiceId: string; category: Rule; subtype: string; note: string; exposure: number };
const labels = labelsRaw as { planted: Label[]; benign: { invoiceId: string; note: string }[] };
const RULES: Rule[] = ["duplicate", "split", "po_mismatch", "bank_change"];
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Score a set of verdicts against the planted answer key. A planted case counts as caught if it was held. */
export function score(version: AgentVersion, engine: "rules" | "llm", verdicts: Verdict[]): EvalReport {
  const held = new Map(verdicts.filter((v) => v.decision === "hold").map((v) => [v.invoiceId, v]));
  const planted = new Map(labels.planted.map((l) => [l.invoiceId, l]));
  const row = (id: string, rule: Rule, note: string) => {
    const inv = getInvoice(id)!;
    return { invoiceId: id, vendor: getVendor(inv.vendorId).name, invoiceNumber: inv.invoiceNumber, amount: inv.amount, rule, note };
  };
  const caught = labels.planted.filter((l) => held.has(l.invoiceId));
  const misses = labels.planted.filter((l) => !held.has(l.invoiceId));
  const fps = [...held.values()].filter((v) => !planted.has(v.invoiceId));
  const benignNote = new Map(labels.benign.map((b) => [b.invoiceId, b.note]));
  return {
    version,
    engine,
    planted: labels.planted.length,
    caught: caught.length,
    missed: misses.length,
    falsePositives: fps.length,
    precision: held.size ? caught.length / held.size : 0,
    recall: caught.length / labels.planted.length,
    exposureTotal: r2(labels.planted.reduce((a, l) => a + l.exposure, 0)),
    exposureCaught: r2(caught.reduce((a, l) => a + l.exposure, 0)),
    byCategory: RULES.map((rule) => ({
      rule,
      planted: labels.planted.filter((l) => l.category === rule).length,
      caught: caught.filter((l) => l.category === rule).length,
    })),
    overruled: verdicts.filter((v) => v.spans.some((s) => s.name === "model_overruled")).length,
    misses: misses.map((l) => row(l.invoiceId, l.category, l.note)),
    fps: fps.map((v) => row(v.invoiceId, v.signals[0]?.rule ?? "duplicate", benignNote.get(v.invoiceId) ?? "Not a planted case")),
  };
}
