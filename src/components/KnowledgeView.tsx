"use client";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Building2, ChevronDown, Landmark, Link2, Mail, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentVersion, Invoice, KBGraph, KBStats, KBVendorRow, Line, PurchaseOrder, Receipt, Verdict, VendorChange } from "@/lib/types";
import { EASE, RULES, RuleChip, SPRING, Ticker, fmtDate, fmtDay, usd, usd0 } from "./ui";

export type KBData = { stats: KBStats; rows: Record<AgentVersion, KBVendorRow[]> };
export type KBFocus = { vendorId: string; invoiceId?: string; n: number };

// ---------------------------------------------------------------------------
// Graph layout: one row per document chain (PO → receipt → invoice), the vendor
// and its bank accounts on the left, duplicate and split links in a right gutter.
// ---------------------------------------------------------------------------
const NW = 172, NH = 48, ROW = 60, GAP = 40, TOP = 34, GUTTER = 112, VH = 92, BGAP = 10, LIMIT = 8;

type Kind = "vendor" | "bank" | "po" | "receipt" | "invoice";
type Tone = "plain" | "muted" | "held" | "ok" | "risk";
type BankInfo = { name: string; last4: string; role: "current" | "old" | "unknown"; change?: VendorChange; invoice?: Invoice };
type GNode = {
  id: string; kind: Kind; x: number; y: number; h: number; col: number; tone: Tone;
  title: string; sub: string; amount?: string;
  inv?: Invoice; po?: PurchaseOrder; rc?: Receipt; bank?: BankInfo;
};
type GEdge = { id: string; a: string; b: string; d: string; risk: boolean; delay: number; dashed?: boolean };
type GMark = { id: string; d: string; label: string[]; lx: number; ly: number; ends: string[] };
type Layout = { W: number; H: number; cols: string[]; nodes: GNode[]; edges: GEdge[]; marks: GMark[]; hidden: number };

const xOf = (c: number) => c * (NW + GAP);
const mid = (n: GNode) => n.y + n.h / 2;
const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const dx = Math.max(24, (x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
};
const bankId = (name: string, last4: string) => `bank:${name}:${last4}`;
const units = (lines: { qty: number }[]) => lines.reduce((a, l) => a + l.qty, 0).toLocaleString("en-US");

function layout(g: KBGraph, showAll: boolean): Layout {
  const hasPO = g.pos.length > 0;
  const cols = hasPO ? ["Vendor", "Purchase orders", "Goods receipts", "Invoices"] : ["Vendor", "Invoices"];
  const invCol = cols.length - 1;
  const verdict = (id: string) => g.verdicts[id];
  const held = (id: string) => verdict(id)?.decision === "hold";

  type Chain = { po?: PurchaseOrder; rc?: Receipt; invs: Invoice[]; date: string; pending: boolean };
  const byDate = (a: Invoice, b: Invoice) => a.invoiceDate.localeCompare(b.invoiceDate) || a.id.localeCompare(b.id);
  const poIds = new Set(g.pos.map((p) => p.id));
  const chains: Chain[] = g.pos.map((po) => {
    const invs = g.invoices.filter((i) => i.poId === po.id).sort(byDate);
    return { po, rc: g.receipts.find((r) => r.poId === po.id), invs, date: invs.at(-1)?.invoiceDate ?? po.date, pending: invs.some((i) => i.status === "pending") };
  });
  for (const inv of g.invoices.filter((i) => !i.poId || !poIds.has(i.poId)))
    chains.push({ invs: [inv], date: inv.invoiceDate, pending: inv.status === "pending" });
  const order = (a: Chain, b: Chain) => Number(b.pending) - Number(a.pending) || b.date.localeCompare(a.date);
  chains.sort(order);

  // Keep the run's invoices and anything they point at; fold away older history.
  const must = new Set<string>();
  for (const v of Object.values(g.verdicts))
    for (const s of v.signals) if (s.evidence.kind === "duplicate") must.add(s.evidence.original.id);
  let shown = chains;
  if (!showAll && chains.length > LIMIT) {
    const keep = chains.filter((c) => c.pending || c.invs.some((i) => must.has(i.id)));
    const rest = chains.filter((c) => !keep.includes(c)).slice(0, Math.max(2, LIMIT - keep.length));
    shown = [...keep, ...rest].sort(order);
  }

  // Bank accounts: the one on file, any it replaced, and any an invoice asks for that is not on file.
  const banks: BankInfo[] = [];
  const unverifiedNow = g.changes.some((c) => c.verified === "none" && c.new.last4 === g.vendor.bank.last4);
  banks.push({ name: g.vendor.bank.name, last4: g.vendor.bank.last4, role: "current", change: g.changes.find((c) => c.new.last4 === g.vendor.bank.last4) });
  for (const c of g.changes) if (!banks.some((b) => b.last4 === c.old.last4)) banks.push({ name: c.old.name, last4: c.old.last4, role: "old", change: c });
  for (const inv of g.invoices)
    if (inv.status === "pending" && inv.payToLast4 !== g.vendor.bank.last4 && !banks.some((b) => b.last4 === inv.payToLast4))
      banks.push({ name: "Not on file", last4: inv.payToLast4, role: "unknown", invoice: inv });

  const rows = shown.reduce((a, c) => a + Math.max(1, c.invs.length), 0);
  const blockH = VH + banks.length * (NH + BGAP);
  const inner = Math.max(rows * ROW, blockH);
  const H = TOP + inner + 8;
  const W = xOf(invCol) + NW + GUTTER;
  const by = TOP + (inner - blockH) / 2;
  const ry = TOP + (inner - rows * ROW) / 2;

  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const marks: GMark[] = [];
  const link = (a: GNode, b: GNode, risk: boolean) =>
    edges.push({ id: `${a.id}>${b.id}`, a: a.id, b: b.id, d: curve(a.x + NW, mid(a), b.x, mid(b)), risk, delay: 0.15 + b.col * 0.12 });

  const vendorNode: GNode = { id: "vendor", kind: "vendor", x: 0, y: by, h: VH, col: 0, tone: "plain", title: g.vendor.name, sub: `${g.vendor.category} · ${g.vendor.terms}` };
  nodes.push(vendorNode);
  let prev = vendorNode;
  banks.forEach((b, i) => {
    const n: GNode = {
      id: bankId(b.name, b.last4), kind: "bank", x: 0, y: by + VH + BGAP + i * (NH + BGAP), h: NH, col: 0,
      tone: b.role === "unknown" || (b.role === "current" && unverifiedNow) ? "risk" : b.role === "old" ? "muted" : "plain",
      title: b.name,
      sub: `•••• ${b.last4} · ${b.role === "current" ? (b.change ? `since ${fmtDay(b.change.date)}` : "on file") : b.role === "old" ? `until ${fmtDay(b.change!.date)}` : "asked for by invoice"}`,
      bank: b,
    };
    nodes.push(n);
    edges.push({ id: `${prev.id}|${n.id}`, a: prev.id, b: n.id, d: `M22 ${prev.y + prev.h} V${n.y}`, risk: false, delay: 0.1 });
    prev = n;
  });

  let r = 0;
  for (const c of shown) {
    const n = Math.max(1, c.invs.length);
    const cy = ry + (r + n / 2) * ROW;
    const sigs = c.invs.flatMap((i) => verdict(i.id)?.signals ?? []);
    const poIssues = sigs.flatMap((s) => (s.evidence.kind === "po" ? s.evidence.issues : []));
    let from = vendorNode;
    if (c.po) {
      const poNode: GNode = {
        id: c.po.id, kind: "po", x: xOf(1), y: cy - NH / 2, h: NH, col: 1, tone: poIssues.length ? "risk" : "plain",
        title: c.po.id, amount: usd0(c.po.total), sub: `${c.po.lines.length} line${c.po.lines.length === 1 ? "" : "s"} · ${c.po.approver}`, po: c.po,
      };
      nodes.push(poNode);
      link(vendorNode, poNode, poIssues.length > 0);
      from = poNode;
      if (c.rc) {
        const short = poIssues.some((x) => x.type === "not_received");
        const rcNode: GNode = {
          id: c.rc.id, kind: "receipt", x: xOf(2), y: cy - NH / 2, h: NH, col: 2, tone: short ? "risk" : "plain",
          title: c.rc.id, sub: `${fmtDay(c.rc.date)} · ${units(c.rc.lines)} units`, rc: c.rc,
        };
        nodes.push(rcNode);
        link(poNode, rcNode, short);
        from = rcNode;
      }
    }
    c.invs.forEach((inv, k) => {
      const v = verdict(inv.id);
      const node: GNode = {
        id: inv.id, kind: "invoice", x: xOf(invCol), y: ry + (r + k) * ROW + (ROW - NH) / 2, h: NH, col: invCol,
        tone: v?.decision === "hold" ? "held" : inv.status === "pending" ? "ok" : "muted",
        title: inv.invoiceNumber, amount: usd0(inv.amount),
        sub: inv.status === "paid" ? `Paid ${fmtDay(inv.paidAt!)}` : v?.decision === "hold" ? `Held · ${RULES[v.signals[0].rule].short}` : "Clear to pay",
        inv,
      };
      nodes.push(node);
      link(from, node, held(inv.id));
    });
    r += n;
  }

  const at = new Map(nodes.map((n) => [n.id, n]));
  // Bank problems: a dashed line from the account the money would go to, straight to the invoice.
  for (const v of Object.values(g.verdicts)) {
    const inv = at.get(v.invoiceId);
    if (!inv || v.decision !== "hold") continue;
    for (const s of v.signals) {
      if (s.evidence.kind !== "bank") continue;
      const c = s.evidence.change;
      const b = at.get(c ? bankId(c.new.name, c.new.last4) : bankId("Not on file", s.evidence.invoiceLast4));
      if (b) edges.push({ id: `${b.id}~${inv.id}`, a: b.id, b: inv.id, d: curve(b.x + NW, mid(b), inv.x, mid(inv)), risk: true, delay: 0.7, dashed: true });
    }
  }
  // Duplicates and splits live in the gutter to the right of the invoices.
  const xr = xOf(invCol) + NW;
  const seen = new Set<string>();
  for (const v of Object.values(g.verdicts)) {
    const a = at.get(v.invoiceId);
    if (!a) continue;
    for (const s of v.signals) {
      if (s.evidence.kind === "duplicate") {
        const b = at.get(s.evidence.original.id);
        if (!b) continue;
        const [y1, y2] = [mid(a), mid(b)];
        const bend = Math.min(GUTTER - 40, 26 + Math.abs(y2 - y1) * 0.3);
        marks.push({ id: `dup:${a.id}`, d: `M${xr} ${y1} C${xr + bend} ${y1}, ${xr + bend} ${y2}, ${xr} ${y2}`, label: ["Same bill"], lx: xr + bend * 0.75, ly: (y1 + y2) / 2, ends: [a.id, b.id] });
      }
      if (s.evidence.kind === "split") {
        const ids = [v.invoiceId, ...s.evidence.siblings.map((x) => x.id)].sort();
        const key = ids.join();
        if (seen.has(key)) continue;
        seen.add(key);
        const ys = ids.map((id) => at.get(id)).filter((n): n is GNode => !!n).map(mid);
        const xb = xr + 18;
        marks.push({
          id: `split:${key}`, d: `${ys.map((y) => `M${xr} ${y} H${xb}`).join(" ")} M${xb} ${Math.min(...ys)} V${Math.max(...ys)}`,
          label: [usd0(s.evidence.total), "split"], lx: xb + 6, ly: (Math.min(...ys) + Math.max(...ys)) / 2, ends: ids,
        });
      }
    }
  }
  return { W, H, cols, nodes, edges, marks, hidden: chains.length - shown.length };
}

/** Nodes connected to `id`, without fanning out through the vendor or its bank accounts. */
function neighbourhood(id: string, L: Layout) {
  const adj = new Map<string, string[]>();
  const add = (a: string, b: string) => {
    adj.set(a, [...(adj.get(a) ?? []), b]);
    adj.set(b, [...(adj.get(b) ?? []), a]);
  };
  for (const e of L.edges) add(e.a, e.b);
  for (const m of L.marks) for (const e of m.ends.slice(1)) add(m.ends[0], e);
  const out = new Set([id]);
  const q = [id];
  while (q.length) {
    const x = q.shift()!;
    if (x !== id && (x === "vendor" || x.startsWith("bank:"))) continue;
    for (const y of adj.get(x) ?? []) if (!out.has(y)) (out.add(y), q.push(y));
  }
  return out;
}

/** The records the agent's tools read when it checked this invoice. */
function recordsRead(g: KBGraph, invId: string | null) {
  const out = new Set<string>();
  const v = invId ? g.verdicts[invId] : undefined;
  const inv = invId ? g.invoices.find((i) => i.id === invId) : undefined;
  if (!v || !inv) return out;
  out.add(bankId(g.vendor.bank.name, g.vendor.bank.last4));
  if (inv.poId) {
    out.add(inv.poId);
    const rc = g.receipts.find((r) => r.poId === inv.poId);
    if (rc && v.version === "v2") out.add(rc.id); // v1 only compares header totals
  }
  for (const s of v.signals) {
    const ev = s.evidence;
    if (ev.kind === "duplicate") out.add(ev.original.id);
    if (ev.kind === "split") ev.siblings.forEach((x) => out.add(x.id));
    if (ev.kind === "bank") {
      if (ev.change) (out.add(bankId(ev.change.new.name, ev.change.new.last4)), out.add(bankId(ev.change.old.name, ev.change.old.last4)));
      else out.add(bankId("Not on file", ev.invoiceLast4));
    }
  }
  out.delete(invId!);
  return out;
}

// ---------------------------------------------------------------------------

type Props = { kb: KBData; version: AgentVersion; focus: KBFocus | null };

export function KnowledgeView({ kb, version, focus }: Props) {
  const rows = kb.rows[version];
  const [vendorId, setVendorId] = useState(focus?.vendorId ?? rows[0].id);
  const [graph, setGraph] = useState<KBGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const wantSel = useRef<string | undefined>(focus?.invoiceId);
  const cache = useRef(new Map<string, KBGraph>());

  useEffect(() => {
    if (!focus) return;
    wantSel.current = focus.invoiceId;
    setVendorId(focus.vendorId);
  }, [focus]);

  useEffect(() => {
    const key = `${vendorId}:${version}`;
    const hit = cache.current.get(key);
    if (hit) return setGraph(hit);
    let off = false;
    fetch(`/api/kb?vendor=${vendorId}&version=${version}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not load records (${r.status})`))))
      .then((g: KBGraph) => {
        if (off) return;
        cache.current.set(key, g);
        setGraph(g);
        setError(null);
      })
      .catch((e) => !off && setError(e.message));
    return () => {
      off = true;
    };
  }, [vendorId, version]);

  // Pick something sensible to inspect whenever a new vendor's graph arrives.
  useEffect(() => {
    if (!graph) return;
    setShowAll(false);
    setHover(null);
    const want = wantSel.current;
    wantSel.current = undefined;
    const firstHeld = Object.values(graph.verdicts).find((v) => v.decision === "hold")?.invoiceId;
    setSel((cur) => want ?? (cur && graph.invoices.some((i) => i.id === cur) ? cur : (firstHeld ?? "vendor")));
  }, [graph]);

  const L = useMemo(() => (graph ? layout(graph, showAll) : null), [graph, showAll]);
  const lit = useMemo(() => (L && hover ? neighbourhood(hover, L) : null), [L, hover]);
  const selInvoice = graph?.invoices.find((i) => i.id === sel) ?? null;
  const read = useMemo(() => (graph ? recordsRead(graph, selInvoice?.id ?? null) : new Set<string>()), [graph, selInvoice]);
  const selNode = L?.nodes.find((n) => n.id === sel) ?? null;

  // Fit the canvas to its card on wide screens; scroll it sideways on phones.
  const wrap = useRef<HTMLDivElement>(null);
  const [cw, setCw] = useState(0);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCw(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [graph]);
  const scale = L && cw >= 560 ? Math.min(1, cw / L.W) : 1;

  const flagged = rows.filter((r) => r.held > 0);
  const { stats } = kb;

  return (
    <div className="pt-4 sm:pt-8">
      <p className="eyebrow">Knowledge base</p>
      <h1 className="mt-3 max-w-[17ch] font-serif text-[clamp(38px,7vw,84px)] leading-[0.95] tracking-[-0.02em]">
        Everything the agent <em className="text-ink2">can look up.</em>
      </h1>
      <p className="mt-4 max-w-[66ch] text-ink2">
        Every check is a lookup in five tables: vendors, purchase orders, goods receipts, invoices and the bank change log. There is no document search or embedding index, so each record the agent reads can be named in its trace. Pick an invoice to see which records it read.
      </p>

      <div className="mt-8 grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
        <Count label="Vendors" value={stats.vendors} />
        <Count label="Purchase orders" value={stats.purchaseOrders} />
        <Count label="Goods receipts" value={stats.receipts} />
        <Count label="Invoices" value={stats.invoices} />
        <Count label="Bank changes" value={stats.changes} note={`${stats.unverified} never verified`} />
      </div>

      <div className="mt-9 flex flex-wrap items-center gap-3">
        <VendorPicker rows={rows} value={vendorId} onPick={setVendorId} />
        {flagged.length > 0 && (
          <LayoutGroup id="kb-flagged">
            <div className="scroll-thin -mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-1 py-1">
              <span className="mr-1 shrink-0 text-xs text-ink3">Held in this run</span>
              {flagged.map((r) => (
                <button key={r.id} onClick={() => setVendorId(r.id)} aria-pressed={vendorId === r.id} className={`relative shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${vendorId === r.id ? "text-bg" : "text-ink2 hover:text-ink"}`}>
                  {vendorId === r.id && <motion.span layoutId="kb-pill" className="absolute inset-0 rounded-full bg-ink" transition={SPRING} />}
                  <span className="relative whitespace-nowrap">
                    {r.name}
                    <span className={`num ml-1.5 ${vendorId === r.id ? "text-bg/60" : "text-hold"}`}>{r.held}</span>
                  </span>
                </button>
              ))}
            </div>
          </LayoutGroup>
        )}
      </div>

      <div className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium">{graph ? graph.vendor.name : "Loading records"}</h2>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink2">
              <Key bar="bg-hold" label="Held" />
              <Key bar="bg-okfill" label="Clear to pay" />
              <Key bar="bg-line2" label="Paid earlier" />
              <span className="inline-flex items-center gap-1.5">
                <span className="size-2.5 rounded-full bg-ink" /> Read for the selected invoice
              </span>
            </div>
          </div>

          {error && <p className="text-sm text-hold">{error}</p>}
          <div ref={wrap} className="scroll-thin -mx-1 overflow-x-auto px-1 pb-1">
            <AnimatePresence mode="wait" initial={false}>
              {L && graph ? (
                <motion.div key={`${graph.vendor.id}:${version}:${showAll}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.15 } }} style={{ height: L.H * scale, width: scale < 1 ? L.W * scale : L.W }}>
                  <div className="relative origin-top-left" style={{ width: L.W, height: L.H, transform: scale < 1 ? `scale(${scale})` : undefined }}>
                    {L.cols.map((c, i) => (
                      <span key={c} className="eyebrow absolute top-0 whitespace-nowrap" style={{ left: xOf(i) }}>
                        {c}
                      </span>
                    ))}
                    <svg width={L.W} height={L.H} className="pointer-events-none absolute left-0 top-0 overflow-visible" aria-hidden>
                      {L.edges.map((e) => {
                        const dim = lit && !(lit.has(e.a) && lit.has(e.b));
                        const style = { stroke: e.risk ? "var(--hold)" : "var(--line2)", opacity: dim ? 0.1 : 1, transition: "opacity .2s" };
                        return e.dashed ? (
                          <motion.path key={e.id} d={e.d} fill="none" strokeWidth={1.75} strokeDasharray="5 5" style={style} initial={{ opacity: 0 }} animate={{ opacity: dim ? 0.1 : 1 }} transition={{ delay: lit ? 0 : e.delay, duration: 0.5 }} />
                        ) : (
                          <motion.path key={e.id} d={e.d} fill="none" strokeWidth={e.risk ? 1.75 : 1.25} style={style} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: e.delay, duration: 0.7, ease: EASE }} />
                        );
                      })}
                      {L.marks.map((m) => (
                        <motion.path key={m.id} d={m.d} fill="none" strokeWidth={1.75} strokeLinecap="round" style={{ stroke: "var(--hold)", opacity: lit && !m.ends.some((x) => lit.has(x)) ? 0.1 : 1, transition: "opacity .2s" }} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.8, duration: 0.6, ease: EASE }} />
                      ))}
                    </svg>
                    {L.marks.map((m) => (
                      <motion.span key={m.id} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 1.1, type: "spring", stiffness: 400, damping: 24 }} className="absolute -translate-y-1/2 rounded-md bg-hold px-1.5 py-0.5 text-[10px] font-medium leading-tight text-white" style={{ left: m.lx, top: m.ly }}>
                        {m.label.map((t) => (
                          <span key={t} className="block whitespace-nowrap">{t}</span>
                        ))}
                      </motion.span>
                    ))}
                    {L.nodes.map((n, i) => (
                      <NodeBox key={n.id} n={n} i={i} selected={sel === n.id} read={read.has(n.id)} dim={!!lit && !lit.has(n.id)} onHover={setHover} onSelect={setSel} />
                    ))}
                  </div>
                </motion.div>
              ) : (
                <motion.div key="skeleton" animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ repeat: Infinity, duration: 1.4 }} className="h-[460px] rounded-2xl bg-bg" />
              )}
            </AnimatePresence>
          </div>

          {L && (L.hidden > 0 || showAll) && (
            <button onClick={() => setShowAll((s) => !s)} className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5 text-xs text-ink2 transition-colors hover:text-ink">
              <motion.span animate={{ rotate: showAll ? 180 : 0 }}>
                <ChevronDown size={13} />
              </motion.span>
              {showAll ? "Show only this run and what it points to" : `Show ${L.hidden} older purchase${L.hidden === 1 ? "" : "s"}`}
            </button>
          )}
        </section>

        <aside className="self-start rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-6 xl:sticky xl:top-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={`${graph?.vendor.id}:${sel}:${version}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6, transition: { duration: 0.12 } }} transition={{ duration: 0.3, ease: EASE }}>
              {graph && selNode ? (
                <Inspector g={graph} n={selNode} readCount={read.size} onSelect={setSel} />
              ) : (
                <p className="text-sm text-ink2">Pick any record in the graph to inspect it.</p>
              )}
            </motion.div>
          </AnimatePresence>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const TONE: Record<Tone, string> = {
  plain: "border-line bg-raised",
  ok: "border-line bg-raised",
  muted: "border-line bg-surface text-ink2",
  held: "border-hold/45 bg-holdsoft",
  risk: "border-hold/45 bg-holdsoft",
};
const BAR: Record<Tone, string> = { plain: "bg-line2", ok: "bg-okfill", muted: "bg-line2", held: "bg-hold", risk: "bg-hold" };

function NodeBox({ n, i, selected, read, dim, onHover, onSelect }: { n: GNode; i: number; selected: boolean; read: boolean; dim: boolean; onHover: (id: string | null) => void; onSelect: (id: string) => void }) {
  const big = n.kind === "vendor" || n.kind === "bank";
  const Icon = n.kind === "vendor" ? Building2 : Landmark;
  return (
    <motion.div className="absolute" style={{ left: n.x, top: n.y, width: NW, height: n.h }} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: n.col * 0.12 + Math.min(i, 24) * 0.012, duration: 0.45, ease: EASE }}>
      <button
        onMouseEnter={() => onHover(n.id)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(n.id)} onBlur={() => onHover(null)} onClick={() => onSelect(n.id)}
        aria-pressed={selected} aria-label={`${n.title}, ${n.sub}`}
        className={`relative flex h-full w-full items-center gap-2.5 overflow-hidden rounded-xl border pl-3 pr-2.5 text-left transition-[opacity,box-shadow,transform] duration-200 hover:-translate-y-px hover:shadow-card ${TONE[n.tone]} ${dim ? "opacity-25" : ""} ${selected ? "ring-2 ring-ink ring-offset-2 ring-offset-surface" : ""}`}
      >
        {big ? (
          <span className={`grid size-7 shrink-0 place-items-center self-start ${n.kind === "vendor" ? "mt-3" : "mt-2.5"} rounded-lg ${n.tone === "risk" ? "bg-hold text-white" : "bg-bg text-ink2"}`}>
            <Icon size={14} />
          </span>
        ) : (
          <span className={`absolute inset-y-2 left-1.5 w-[3px] rounded-full ${BAR[n.tone]}`} />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className={`${n.kind === "vendor" ? "line-clamp-2 text-[14px]" : "truncate text-[13px]"} font-medium leading-tight ${big ? "" : "num"}`}>{n.title}</span>
            {n.amount && <span className="num shrink-0 text-[12px] text-ink2">{n.amount}</span>}
          </span>
          <span className={`mt-0.5 block truncate text-[11px] leading-tight ${n.tone === "held" || n.tone === "risk" ? "text-hold" : "text-ink3"}`}>{n.sub}</span>
        </span>
      </button>
      <AnimatePresence>
        {read && (
          <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} transition={{ type: "spring", stiffness: 520, damping: 22 }} className="pointer-events-none absolute -right-1.5 -top-1.5 size-3.5 rounded-full bg-ink ring-[3px] ring-surface" />
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------

function Inspector({ g, n, readCount, onSelect }: { g: KBGraph; n: GNode; readCount: number; onSelect: (id: string) => void }) {
  if (n.kind === "invoice" && n.inv) return <InvoiceDetail g={g} inv={n.inv} readCount={readCount} onSelect={onSelect} />;
  if (n.kind === "po" && n.po) {
    const po = n.po;
    const billed = g.invoices.filter((i) => i.poId === po.id).reduce((a, i) => a + i.amount, 0);
    return (
      <>
        <Head kind="Purchase order" title={po.id} />
        <Big>{usd(po.total)}</Big>
        <Facts rows={[["Raised", fmtDate(po.date)], ["Approved by", po.approver], ["Billed against it", usd(billed)], ["Remaining", usd(Math.max(0, po.total - billed))]]} />
        <LineTable lines={po.lines} />
      </>
    );
  }
  if (n.kind === "receipt" && n.rc) {
    const rc = n.rc;
    const po = g.pos.find((p) => p.id === rc.poId);
    return (
      <>
        <Head kind="Goods receipt" title={rc.id} />
        <Facts rows={[["Received", fmtDate(rc.date)], ["Against", rc.poId]]} />
        <ul className="mt-5 text-sm">
          <li className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-line pb-2 text-xs text-ink3">
            <span>Item</span>
            <span>Ordered</span>
            <span>Received</span>
          </li>
          {rc.lines.map((l) => {
            const ordered = po?.lines.find((p) => p.desc === l.desc)?.qty ?? 0;
            return (
              <li key={l.desc} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-line py-2 last:border-0">
                <span className="min-w-0 truncate">{l.desc}</span>
                <span className="num w-14 text-right">{ordered}</span>
                <span className={`num w-14 text-right ${l.qty < ordered ? "text-hold" : ""}`}>{l.qty}</span>
              </li>
            );
          })}
        </ul>
      </>
    );
  }
  if (n.kind === "bank" && n.bank) {
    const b = n.bank;
    const c = b.change;
    return (
      <>
        <Head kind={b.role === "current" ? "Bank account on file" : b.role === "old" ? "Replaced bank account" : "Account not on file"} title={b.name} />
        <Big>•••• {b.last4}</Big>
        {b.role === "unknown" && b.invoice && (
          <Note risk>
            Invoice <button className="num underline underline-offset-2" onClick={() => onSelect(b.invoice!.id)}>{b.invoice.invoiceNumber}</button> asks to be paid into this account. It is not on the vendor record.
          </Note>
        )}
        {c && (
          <div className="mt-5 rounded-2xl border border-line bg-raised p-4 text-sm">
            <p className="flex items-center gap-2 text-xs text-ink3">
              <Mail size={13} /> Change requested {fmtDate(c.date)} by {c.source}
            </p>
            <p className="num mt-2 break-all text-xs">{c.from}</p>
            <p className="mt-2 leading-relaxed text-ink2">{c.body}</p>
            <p className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium ${c.verified === "none" ? "text-hold" : "text-ok"}`}>
              {c.verified === "none" ? <ShieldAlert size={13} /> : <ShieldCheck size={13} />}
              {c.verified === "none" ? "Never verified by callback" : "Verified by callback"}
            </p>
          </div>
        )}
      </>
    );
  }
  const v = g.vendor;
  return (
    <>
      <Head kind="Vendor" title={v.name} />
      <Facts rows={[["Category", v.category], ["Terms", v.terms], ["Phone on file", v.phoneOnFile], ["Domain", v.domain], ["Invoices", String(g.invoices.length)], ["Purchase orders", String(g.pos.length)]]} />
      {g.sharedBankWith.length > 0 && (
        <Note risk>
          <Link2 size={14} className="mb-1" />
          Shares a bank account with {g.sharedBankWith.map((s) => s.name).join(", ")}. Two vendor records paying into one account is how the same invoice gets paid twice under different names.
        </Note>
      )}
    </>
  );
}

function InvoiceDetail({ g, inv, readCount, onSelect }: { g: KBGraph; inv: Invoice; readCount: number; onSelect: (id: string) => void }) {
  const v: Verdict | undefined = g.verdicts[inv.id];
  const wrongAccount = inv.payToLast4 !== g.vendor.bank.last4 && inv.status === "pending";
  return (
    <>
      <Head kind="Invoice" title={inv.invoiceNumber} />
      <Big>{usd(inv.amount)}</Big>
      <Facts
        rows={[
          ["Dated", fmtDate(inv.invoiceDate)],
          inv.status === "paid" ? ["Paid", fmtDate(inv.paidAt!)] : ["Due", fmtDate(inv.dueDate)],
          ["Purchase order", inv.poId ?? "None"],
          ["Pays into", `•••• ${inv.payToLast4}`, wrongAccount],
        ]}
      />
      <LineTable lines={inv.lines} />
      {v ? (
        <div className={`mt-5 rounded-2xl border p-4 ${v.decision === "hold" ? "border-hold/30 bg-holdsoft" : "border-line bg-raised"}`}>
          <p className={`flex items-center gap-2 text-sm font-medium ${v.decision === "hold" ? "text-hold" : "text-ok"}`}>
            {v.decision === "hold" ? <ShieldAlert size={15} /> : <ShieldCheck size={15} />}
            {v.decision === "hold" ? `Held by agent ${v.version}` : `Cleared by agent ${v.version}`}
          </p>
          {v.signals.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {v.signals.map((s) => (
                <RuleChip key={s.rule} rule={s.rule} />
              ))}
            </div>
          )}
          {v.signals.map((s) => (
            <p key={s.rule} className="mt-2 text-[13px] leading-snug">{s.detail}</p>
          ))}
          <ul className="mt-3 grid gap-1 border-t border-line pt-3">
            {v.spans.filter((s) => s.type === "tool").map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="num truncate text-ink2">{s.name}</span>
                <span className={s.flagged ? "font-medium text-hold" : "text-ink3"}>{s.flagged ? "problem" : "ok"}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink3">
            <span className="mr-1.5 inline-block size-2 rounded-full bg-ink align-middle" />
            {readCount} linked record{readCount === 1 ? "" : "s"} read, marked in the graph
          </p>
          {v.signals.map((s) =>
            s.evidence.kind === "duplicate" ? (
              <button key="dup" onClick={() => onSelect((s.evidence as { original: { id: string } }).original.id)} className="mt-2 block text-xs text-ink underline underline-offset-2">
                Open the earlier invoice
              </button>
            ) : null,
          )}
        </div>
      ) : (
        <p className="mt-5 text-xs leading-relaxed text-ink3">Paid before this run. The agent reads it when it checks newer invoices from this vendor for duplicates.</p>
      )}
    </>
  );
}

function Head({ kind, title }: { kind: string; title: string }) {
  return (
    <>
      <p className="eyebrow">{kind}</p>
      <p className="mt-1.5 text-lg font-medium leading-tight">{title}</p>
    </>
  );
}
function Big({ children }: { children: React.ReactNode }) {
  return <p className="num mt-3 text-3xl tracking-tight">{children}</p>;
}
function Facts({ rows }: { rows: (readonly [string, string] | readonly [string, string, boolean])[] }) {
  return (
    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      {rows.map(([k, val, bad]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-ink3">{k}</dt>
          <dd className={`mt-0.5 truncate ${bad ? "font-medium text-hold" : ""}`}>{val}</dd>
        </div>
      ))}
    </dl>
  );
}
function LineTable({ lines }: { lines: Line[] }) {
  return (
    <ul className="mt-5 text-sm">
      {lines.map((l, i) => (
        <li key={i} className="flex items-baseline justify-between gap-3 border-b border-line py-2 last:border-0">
          <span className="min-w-0">
            <span className="block truncate">{l.desc}</span>
            <span className="num text-[11px] text-ink3">
              {l.qty.toLocaleString("en-US")} × {usd(l.unitPrice)}
            </span>
          </span>
          <span className="num shrink-0">{usd(l.qty * l.unitPrice)}</span>
        </li>
      ))}
    </ul>
  );
}
function Note({ children, risk }: { children: React.ReactNode; risk?: boolean }) {
  return <div className={`mt-5 rounded-2xl border p-4 text-[13px] leading-relaxed ${risk ? "border-hold/30 bg-holdsoft" : "border-line"}`}>{children}</div>;
}
function Key({ bar, label }: { bar: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-3 w-[3px] rounded-full ${bar}`} />
      {label}
    </span>
  );
}

function Count({ label, value, note }: { label: string; value: number; note?: string }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setV(value), 150);
    return () => clearTimeout(t);
  }, [value]);
  return (
    <div className="border-l border-line pl-4">
      <p className="text-xs text-ink2">{label}</p>
      <p className="mt-1 font-serif text-[clamp(28px,4vw,40px)] leading-none">
        <Ticker value={v} format={(n) => Math.round(n).toLocaleString("en-US")} />
      </p>
      {note && <p className="mt-1 text-[11px] text-hold">{note}</p>}
    </div>
  );
}

function VendorPicker({ rows, value, onPick }: { rows: KBVendorRow[]; value: string; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const list = rows.filter((r) => r.name.toLowerCase().includes(q.trim().toLowerCase()));
  const current = rows.find((r) => r.id === value);
  const pick = (id: string) => {
    onPick(id);
    setOpen(false);
    input.current?.blur();
  };
  return (
    <div className="relative w-full sm:w-80">
      <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink3" />
      <input
        ref={input} value={open ? q : current?.name ?? ""} placeholder={`Search ${rows.length} vendors`} aria-label="Find a vendor"
        onFocus={() => (setOpen(true), setQ(""))} onBlur={() => setTimeout(() => setOpen(false), 120)} onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && list[0]) pick(list[0].id);
          if (e.key === "Escape") input.current?.blur();
        }}
        className="h-11 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-sm outline-none transition-colors placeholder:text-ink3 focus:border-ink"
      />
      <AnimatePresence>
        {open && (
          <motion.ul initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -6, scale: 0.98 }} transition={{ duration: 0.16 }} className="scroll-thin absolute z-30 mt-2 max-h-80 w-full origin-top overflow-y-auto rounded-2xl border border-line bg-raised p-1.5 shadow-card">
            {list.map((r) => (
              <li key={r.id}>
                <button onMouseDown={(e) => e.preventDefault()} onClick={() => pick(r.id)} className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-bg ${r.id === value ? "bg-bg" : ""}`}>
                  <span className="min-w-0">
                    <span className="block truncate text-sm">{r.name}</span>
                    <span className="block text-[11px] text-ink3">
                      {r.category} · {r.invoices} invoices{r.bankChanges ? ` · ${r.bankChanges} bank change` : ""}
                    </span>
                  </span>
                  {r.held > 0 && <span className="num shrink-0 rounded-full bg-holdsoft px-2 py-0.5 text-[11px] text-hold">{r.held} held</span>}
                </button>
              </li>
            ))}
            {!list.length && <li className="px-3 py-2 text-sm text-ink3">No vendor matches “{q}”</li>}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
