import raw from "@/data/dataset.json";
import type {
  AgentVersion, Dataset, Evidence, Invoice, InvoiceLite, PurchaseOrder, QueueItem, Rule, Signal, Span, Vendor, Verdict,
} from "./types";

export const data = raw as unknown as Dataset;
const { approvalThreshold, runDate } = data.meta;

const vendorById = new Map(data.vendors.map((v) => [v.id, v]));
const invoiceById = new Map(data.invoices.map((i) => [i.id, i]));
const poById = new Map(data.purchaseOrders.map((p) => [p.id, p]));

export const getInvoice = (id: string) => invoiceById.get(id);
export const getVendor = (id: string) => vendorById.get(id) as Vendor;
export const queue = (): QueueItem[] =>
  data.runOrder.map((id) => {
    const invoice = invoiceById.get(id)!;
    return { invoice, vendor: getVendor(invoice.vendorId) };
  });

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const daysBetween = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const lite = ({ id, invoiceNumber, invoiceDate, amount, poId, status, paidAt, lines }: Invoice): InvoiceLite => ({
  id, invoiceNumber, invoiceDate, amount, poId, status, paidAt, lines,
});
/** INV-01042-R, INV1042 and inv-1042 all reduce to "1042". */
const coreNumber = (n: string) => (n.match(/\d+/g) ?? []).sort((a, b) => b.length - a.length)[0]?.replace(/^0+/, "") ?? n;

// ---------------------------------------------------------------------------
// Tools. Each returns a plain result for the trace and, if something is wrong,
// a Signal. v1 is the baseline agent; v2 is the version after the fixes.
// ---------------------------------------------------------------------------
type ToolOut = { result: unknown; signal?: Signal };
type Tool = { name: string; description: string; versions: AgentVersion[]; run: (inv: Invoice, v: AgentVersion) => ToolOut };

const searchInvoiceHistory: Tool = {
  name: "search_invoice_history",
  description: "Search this vendor's earlier invoices for one that is the same bill as this invoice.",
  versions: ["v1", "v2"],
  run(inv, version) {
    const others = data.invoices.filter((o) => o.vendorId === inv.vendorId && o.id !== inv.id);
    const sameAmount = (o: Invoice) => Math.abs(o.amount - inv.amount) <= Math.max(0.01, inv.amount * 0.01);
    let match: Invoice | undefined;
    let matchType: "exact_number" | "fuzzy_number" | "same_amount_window" | undefined;

    match = others.find((o) => o.invoiceNumber === inv.invoiceNumber);
    if (match) matchType = "exact_number";
    if (!match && version === "v2") {
      match = others.find((o) => coreNumber(o.invoiceNumber) === coreNumber(inv.invoiceNumber) && sameAmount(o));
      if (match) matchType = "fuzzy_number";
    }
    if (!match && version === "v2") {
      match = others.find(
        (o) => sameAmount(o) && o.poId === inv.poId && daysBetween(o.invoiceDate, inv.invoiceDate) <= 10 &&
          // the earlier of the pair is the original; only flag the later one
          (o.invoiceDate < inv.invoiceDate || (o.invoiceDate === inv.invoiceDate && o.id < inv.id)),
      );
      if (match) matchType = "same_amount_window";
    }
    const result = { searched: others.length, method: version === "v1" ? "exact invoice number" : "exact number, normalised number, same amount within 10 days", match: match?.id ?? null, matchType: matchType ?? null };
    if (!match || !matchType) return { result };
    const how = {
      exact_number: `has the same invoice number as ${match.invoiceNumber}`,
      fuzzy_number: `is ${match.invoiceNumber} with the number re-keyed`,
      same_amount_window: `repeats ${match.invoiceNumber}: same amount and ${match.poId ? "purchase order" : "description"}, ${plural(Math.round(daysBetween(match.invoiceDate, inv.invoiceDate)), "day")} apart`,
    }[matchType];
    const state = match.status === "paid" ? `already paid on ${fmt(match.paidAt!)}` : "also in this run";
    return {
      result,
      signal: {
        rule: "duplicate",
        title: "Duplicate invoice",
        detail: `${inv.invoiceNumber} ${how} (${usd(match.amount)}, ${state}). Paying it would pay the same bill twice.`,
        exposure: inv.amount,
        evidence: { kind: "duplicate", matchType, original: lite(match) },
      },
    };
  },
};

const matchPurchaseOrder: Tool = {
  name: "match_purchase_order",
  description: "Three-way match: compare the invoice with its purchase order and the goods receipt.",
  versions: ["v1", "v2"],
  run(inv, version) {
    if (!inv.poId) return { result: { status: "no_po" } };
    const po = poById.get(inv.poId) as PurchaseOrder;
    const issues: Extract<Evidence, { kind: "po" }>["issues"] = [];
    let exposure = 0;

    if (version === "v1") {
      // Baseline: header total only, 10% tolerance, no receipt check.
      if (inv.amount > po.total * 1.1) {
        issues.push({ type: "over_total", desc: "Invoice total", billed: usd(inv.amount), expected: usd(po.total) });
        exposure = inv.amount - po.total;
      }
      const result = { status: issues.length ? "mismatch" : "ok", po: po.id, method: "header total, 10% tolerance", poTotal: po.total, invoiceTotal: inv.amount };
      return issues.length ? { result, signal: poSignal(inv, po, issues, exposure) } : { result };
    }

    const tol = 1.02;
    const receipt = data.receipts.find((r) => r.poId === po.id);
    const priorBilled = data.invoices
      .filter((o) => o.poId === po.id && o.id !== inv.id && (o.status === "paid" || o.id < inv.id))
      .reduce((a, o) => a + o.amount, 0);
    const overTotal = inv.amount > po.total * tol;
    for (const line of inv.lines) {
      const pl = po.lines.find((l) => l.desc === line.desc);
      if (!pl) {
        if (overTotal) {
          issues.push({ type: "unordered_line", desc: line.desc, billed: usd(line.qty * line.unitPrice), expected: "Not on PO" });
          exposure += line.qty * line.unitPrice;
        }
        continue;
      }
      if (line.unitPrice > pl.unitPrice * tol) {
        issues.push({ type: "unit_price", desc: line.desc, billed: `${usd(line.unitPrice)} each`, expected: `${usd(pl.unitPrice)} each` });
        exposure += (line.unitPrice - pl.unitPrice) * line.qty;
      }
      const got = receipt?.lines.find((l) => l.desc === line.desc)?.qty ?? 0;
      if (priorBilled === 0 && line.qty > got) {
        issues.push({ type: "not_received", desc: line.desc, billed: `${line.qty} billed`, expected: `${got} received` });
        exposure += (line.qty - got) * Math.min(line.unitPrice, pl.unitPrice);
      }
    }
    if (!issues.length && priorBilled + inv.amount > po.total * tol) {
      issues.push({ type: "po_overbilled", desc: "Total billed against this PO", billed: usd(priorBilled + inv.amount), expected: usd(po.total) });
      exposure = Math.min(inv.amount, priorBilled + inv.amount - po.total);
    }
    const result = { status: issues.length ? "mismatch" : "ok", po: po.id, method: "line level, 2% tolerance, receipt and cumulative billing", poTotal: po.total, invoiceTotal: inv.amount, priorBilled: r2(priorBilled), issues: issues.length };
    return issues.length ? { result, signal: poSignal(inv, po, issues, exposure) } : { result };
  },
};

function poSignal(inv: Invoice, po: PurchaseOrder, issues: Extract<Evidence, { kind: "po" }>["issues"], exposure: number): Signal {
  const first = issues[0];
  const what = {
    over_total: `is billed at ${first.billed} against a purchase order of ${first.expected}`,
    unit_price: `bills ${first.desc} at ${first.billed}; the purchase order says ${first.expected}`,
    not_received: `bills for goods that have not arrived (${first.desc}: ${first.billed}, ${first.expected})`,
    unordered_line: `includes "${first.desc}" (${first.billed}), which is not on the purchase order`,
    po_overbilled: `takes total billing on ${po.id} to ${first.billed} against an order of ${first.expected}`,
  }[first.type];
  return {
    rule: "po_mismatch",
    title: "Does not match the purchase order",
    detail: `${inv.invoiceNumber} ${what}. ${usd(exposure)} of this payment is not supported.`,
    exposure: r2(exposure),
    evidence: { kind: "po", po, issues },
  };
}

const checkBankDetails: Tool = {
  name: "check_bank_details",
  description: "Compare the account the invoice asks to be paid into with the vendor record and its change history.",
  versions: ["v1", "v2"],
  run(inv, version) {
    const vendor = getVendor(inv.vendorId);
    const mismatch = inv.payToLast4 !== vendor.bank.last4;
    const change =
      version === "v2"
        ? data.vendorChanges.find((c) => c.vendorId === vendor.id && c.verified === "none" && daysBetween(c.date, runDate) <= 45) ?? null
        : null;
    const result = {
      onFile: vendor.bank.last4, invoice: inv.payToLast4, matchesVendorRecord: !mismatch,
      ...(version === "v2" ? { recentUnverifiedChange: change?.id ?? null } : { changeHistoryChecked: false }),
    };
    if (!mismatch && !change) return { result };
    const detail = change
      ? `${vendor.name}'s bank details were changed on ${fmt(change.date)} by ${change.source} from ${change.from}, from ${change.old.name} ending ${change.old.last4} to ${change.new.name} ending ${change.new.last4}. Nobody called the vendor to confirm.`
      : `${inv.invoiceNumber} asks for payment to an account ending ${inv.payToLast4}. The vendor record says ${vendor.bank.name} ending ${vendor.bank.last4}.`;
    return {
      result,
      signal: {
        rule: "bank_change",
        title: change ? "Unverified bank change" : "Pay-to account not on file",
        detail,
        exposure: inv.amount,
        evidence: { kind: "bank", onFile: vendor.bank, invoiceLast4: inv.payToLast4, change },
      },
    };
  },
};

const findRelatedPending: Tool = {
  name: "find_related_pending",
  description: "Find other unpaid invoices from the same vendor that together cross the approval limit.",
  versions: ["v2"],
  run(inv) {
    const under = (i: Invoice) => i.amount < approvalThreshold;
    const siblings = data.invoices.filter(
      (o) => o.status === "pending" && o.id !== inv.id && o.vendorId === inv.vendorId && o.poId === inv.poId &&
        under(o) && daysBetween(o.invoiceDate, inv.invoiceDate) <= 5,
    );
    const total = r2(siblings.reduce((a, o) => a + o.amount, inv.amount));
    const hit = !inv.poId && under(inv) && siblings.length > 0 && total >= approvalThreshold;
    const result = { related: siblings.map((x) => x.id), combined: total, approvalLimit: approvalThreshold, crossesLimit: hit };
    if (!hit) return { result };
    return {
      result,
      signal: {
        rule: "split",
        title: "Split to avoid approval",
        detail: `${siblings.length + 1} invoices from this vendor within ${plural(Math.max(1, Math.round(Math.max(...siblings.map((x) => daysBetween(x.invoiceDate, inv.invoiceDate))))), "day")} add up to ${usd(total)}. Each is under the ${usd(approvalThreshold)} limit that needs CFO approval, and none has a purchase order.`,
        exposure: inv.amount,
        evidence: { kind: "split", siblings: siblings.map(lite), total, threshold: approvalThreshold },
      },
    };
  },
};

export const TOOLS: Tool[] = [searchInvoiceHistory, matchPurchaseOrder, checkBankDetails, findRelatedPending];
export const toolsFor = (v: AgentVersion) => TOOLS.filter((t) => t.versions.includes(v));

const PRIORITY: Rule[] = ["bank_change", "duplicate", "split", "po_mismatch"];
export const sortSignals = (s: Signal[]) => [...s].sort((a, b) => PRIORITY.indexOf(a.rule) - PRIORITY.indexOf(b.rule));

let spanSeq = 0;
export function runTool(tool: Tool, inv: Invoice, version: AgentVersion): { span: Span; signal?: Signal } {
  const t0 = performance.now();
  const out = tool.run(inv, version);
  return {
    span: { id: `s${++spanSeq}`, type: "tool", name: tool.name, input: { invoice_id: inv.id }, output: out.result, ms: r2(performance.now() - t0), flagged: !!out.signal },
    signal: out.signal,
  };
}

/** Deterministic agent: run every tool, hold if any of them finds a problem. */
export function investigate(inv: Invoice, version: AgentVersion): Verdict {
  const spans: Span[] = [];
  const signals: Signal[] = [];
  for (const tool of toolsFor(version)) {
    const { span, signal } = runTool(tool, inv, version);
    spans.push(span);
    if (signal) signals.push(signal);
  }
  return finish(inv, version, "rules", spans, signals, signals.length ? "hold" : "release");
}

export function finish(
  inv: Invoice, version: AgentVersion, engine: "rules" | "llm", spans: Span[], found: Signal[],
  decision: "hold" | "release", rationale?: string,
): Verdict {
  const signals = sortSignals(found);
  // Exposure is the largest single problem, never more than the payment itself.
  const exposure = decision === "hold" ? r2(Math.min(inv.amount, Math.max(0, ...signals.map((s) => s.exposure)))) : 0;
  const text = rationale ?? (signals.length ? signals.map((s) => s.detail).join(" ") : "Invoice number is new, the purchase order and receipt agree, and the bank details match the vendor record.");
  spans.push({
    id: `s${++spanSeq}`, type: "decision", name: decision === "hold" ? "hold_payment" : "release_payment",
    input: { signals: signals.map((s) => s.rule) }, output: { decision, exposure }, ms: 0, flagged: decision === "hold",
  });
  return { invoiceId: inv.id, version, engine, decision, signals, exposure, rationale: text, spans };
}
