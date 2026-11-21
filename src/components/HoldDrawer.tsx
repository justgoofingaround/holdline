"use client";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Check, ChevronDown, Cpu, Database, Gavel, Mail, Phone, ShieldAlert, Wrench, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Evidence, InvoiceLite, QueueItem, Signal, Span, Verdict } from "@/lib/types";
import type { Resolution } from "./App";
import { ResolutionTag } from "./RunView";
import { EASE, RULES, RuleChip, fmtDate, fmtDay, usd } from "./ui";

type Props = {
  item: QueueItem;
  verdict: Verdict;
  resolution: Resolution;
  onClose: () => void;
  onResolve: (r: Resolution) => void;
  onCall: () => void;
  onShowRecords: () => void;
};

export function HoldDrawer({ item, verdict, resolution, onClose, onResolve, onCall, onShowRecords }: Props) {
  const { invoice, vendor } = item;
  const hasBank = verdict.signals.some((s) => s.rule === "bank_change");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40">
      <motion.div className="absolute inset-0 bg-black/40 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} onClick={onClose} />
      <motion.aside
        role="dialog" aria-modal="true" aria-label={`Held payment to ${vendor.name}`}
        initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 320, damping: 36 }}
        className="absolute inset-y-0 right-0 flex w-full flex-col bg-bg shadow-2xl sm:w-[600px] sm:rounded-l-[28px] sm:border-l sm:border-line"
      >
        <div className="scroll-thin flex-1 overflow-y-auto px-5 pb-8 pt-5 sm:px-8 sm:pt-7">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-1.5">
              {verdict.signals.map((s) => (
                <RuleChip key={s.rule} rule={s.rule} />
              ))}
              <ResolutionTag r={resolution} />
            </div>
            <button onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink2 transition-colors hover:text-ink">
              <X size={16} />
            </button>
          </div>

          <Rise i={0}>
            <p className="mt-5 text-sm text-ink2">{vendor.name}</p>
            <p className="font-serif text-[clamp(40px,8vw,60px)] leading-none tracking-tight">{usd(invoice.amount)}</p>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm sm:grid-cols-4">
              <Fact k="Invoice" v={invoice.invoiceNumber} mono />
              <Fact k="Due" v={fmtDay(invoice.dueDate)} />
              <Fact k="Purchase order" v={invoice.poId ?? "None"} mono />
              <Fact k="At risk" v={usd(verdict.exposure)} mono />
            </dl>
          </Rise>

          <Rise i={1}>
            <h3 className="eyebrow mt-8">Why it was held</h3>
            <div className="mt-3 rounded-2xl border border-hold/25 bg-holdsoft p-4">
              <p className="flex gap-2.5 text-[15px] leading-relaxed">
                <ShieldAlert size={18} className="mt-0.5 shrink-0 text-hold" />
                <span>{verdict.rationale}</span>
              </p>
            </div>
          </Rise>

          {invoice.notes && (
            <Rise i={2}>
              <h3 className="eyebrow mt-8">Note from the vendor</h3>
              <div className="mt-3 rounded-2xl border border-line bg-surface p-4">
                <p className="text-[15px] italic leading-relaxed text-ink2">“{invoice.notes}”</p>
                <p className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-bg px-2.5 py-1 text-[11px] text-ink2">
                  <ShieldAlert size={12} /> Read as data. A note cannot release a payment.
                </p>
              </div>
            </Rise>
          )}

          {verdict.signals.map((s, i) => (
            <Rise key={s.rule} i={2 + i}>
              <h3 className="eyebrow mt-8">Evidence · {RULES[s.rule].label}</h3>
              <div className="mt-3">
                <EvidenceBlock signal={s} item={item} />
              </div>
            </Rise>
          ))}

          <Rise i={3 + verdict.signals.length}>
            <div className="mt-8 flex items-center justify-between gap-3">
              <h3 className="eyebrow">What the agent did</h3>
              <button onClick={onShowRecords} className="group inline-flex items-center gap-1.5 text-xs text-ink2 transition-colors hover:text-ink">
                <Database size={13} /> See the records it read
                <ArrowRight size={12} className="transition-transform group-hover:translate-x-0.5" />
              </button>
            </div>
            <ol className="mt-3 rounded-2xl border border-line bg-surface">
              {verdict.spans.map((s) => (
                <SpanRow key={s.id} span={s} />
              ))}
            </ol>
            <p className="mt-2 text-xs text-ink3">
              Agent {verdict.version} · {verdict.engine === "llm" ? "decision made by the model" : "decision made by the rules engine"}
            </p>
          </Rise>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 border-t border-line bg-surface px-5 py-4 sm:rounded-bl-[28px] sm:px-8">
          {hasBank && (
            <motion.button whileTap={{ scale: 0.97 }} onClick={onCall} className="inline-flex h-11 basis-full items-center justify-center gap-2 whitespace-nowrap rounded-full bg-ink px-5 text-sm font-medium text-bg sm:basis-auto">
              <Phone size={15} /> Call vendor on {vendor.phoneOnFile}
            </motion.button>
          )}
          <motion.button
            whileTap={{ scale: 0.97 }} onClick={() => onResolve("held")}
            className={`inline-flex h-11 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-full px-5 text-sm font-medium sm:flex-none ${hasBank ? "border border-line2 text-ink" : "bg-ink text-bg"}`}
          >
            {resolution === "held" && <Check size={15} />} Keep on hold
          </motion.button>
          <motion.button whileTap={{ scale: 0.97 }} onClick={() => onResolve("released")} className="inline-flex h-11 flex-1 items-center justify-center rounded-full border border-line2 px-5 text-sm text-ink2 transition-colors hover:text-ink sm:flex-none">
            Release
          </motion.button>
        </div>
      </motion.aside>
    </div>
  );
}

function Rise({ i, children }: { i: number; children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 + i * 0.07, duration: 0.5, ease: EASE }}>
      {children}
    </motion.div>
  );
}

function Fact({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink3">{k}</dt>
      <dd className={`mt-0.5 truncate ${mono ? "num" : ""}`}>{v}</dd>
    </div>
  );
}

function EvidenceBlock({ signal, item }: { signal: Signal; item: QueueItem }) {
  const ev: Evidence = signal.evidence;
  const { invoice, vendor } = item;

  if (ev.kind === "duplicate") {
    const o = ev.original;
    const rows: [string, string, string][] = [
      ["Number", invoice.invoiceNumber, o.invoiceNumber],
      ["Dated", fmtDate(invoice.invoiceDate), fmtDate(o.invoiceDate)],
      ["Amount", usd(invoice.amount), usd(o.amount)],
      ["Purchase order", invoice.poId ?? "None", o.poId ?? "None"],
      ["First line", invoice.lines[0].desc, o.lines[0].desc],
      ["Status", "Waiting to be paid", o.status === "paid" ? `Paid ${fmtDate(o.paidAt!)}` : "Also in this run"],
    ];
    return (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface text-sm">
        <div className="grid grid-cols-[88px_1fr_1fr] border-b border-line bg-bg/60 px-4 py-2.5 text-xs text-ink3 sm:grid-cols-[120px_1fr_1fr]">
          <span />
          <span>This invoice</span>
          <span>Earlier invoice</span>
        </div>
        {rows.map(([k, a, b], i) => {
          const same = a === b;
          return (
            <motion.div key={k} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.05 }} className="grid grid-cols-[88px_1fr_1fr] items-center gap-x-2 border-b border-line px-4 py-2.5 last:border-0 sm:grid-cols-[120px_1fr_1fr]">
              <span className="text-xs text-ink3">{k}</span>
              <span className={`truncate ${k === "First line" || k === "Status" ? "" : "num"}`}>{a}</span>
              <span className={`flex items-center gap-1.5 truncate ${k === "First line" || k === "Status" ? "" : "num"}`}>
                <span className="truncate">{b}</span>
                {same && k !== "Status" && <span className="shrink-0 rounded-full bg-holdsoft px-1.5 py-0.5 font-sans text-[10px] font-medium text-hold">same</span>}
              </span>
            </motion.div>
          );
        })}
      </div>
    );
  }

  if (ev.kind === "split") {
    const parts: InvoiceLite[] = [invoice, ...ev.siblings].sort((a, b) => a.invoiceNumber.localeCompare(b.invoiceNumber));
    const scale = Math.max(ev.total, ev.threshold) * 1.04;
    return (
      <div className="rounded-2xl border border-line bg-surface p-4">
        <div className="relative pt-6">
          <div className="flex h-9 gap-[2px]">
            {parts.map((p, i) => (
              <motion.div
                key={p.id} title={`${p.invoiceNumber} · ${usd(p.amount)}`}
                initial={{ width: 0 }} animate={{ width: `${(p.amount / scale) * 100}%` }} transition={{ delay: 0.35 + i * 0.18, duration: 0.6, ease: EASE }}
                className={`grid place-items-center overflow-hidden rounded-[4px] text-[11px] ${p.id === invoice.id ? "bg-hold text-white" : "bg-hold/45 text-white"}`}
              >
                <span className="num truncate px-1">{p.invoiceNumber}</span>
              </motion.div>
            ))}
          </div>
          <div className="absolute bottom-[-6px] top-0 border-l-2 border-dashed border-ink" style={{ left: `${(ev.threshold / scale) * 100}%` }}>
            <span className="absolute left-1.5 top-0 whitespace-nowrap text-[11px] leading-none text-ink2">Approval limit {usd(ev.threshold)}</span>
          </div>
        </div>
        <ul className="mt-5 text-sm">
          {parts.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0">
              <span className="min-w-0 truncate">
                <span className="num">{p.invoiceNumber}</span> <span className="text-ink3">· {fmtDay(p.invoiceDate)} · {p.lines[0].desc}</span>
                {p.id === invoice.id && <span className="ml-2 rounded-full bg-holdsoft px-1.5 py-0.5 text-[10px] font-medium text-hold">this one</span>}
              </span>
              <span className="num shrink-0">{usd(p.amount)}</span>
            </li>
          ))}
          <li className="flex items-center justify-between pt-2.5 font-medium">
            <span>Combined</span>
            <span className="num">{usd(ev.total)}</span>
          </li>
        </ul>
      </div>
    );
  }

  if (ev.kind === "po") {
    return (
      <div className="overflow-hidden rounded-2xl border border-line bg-surface text-sm">
        <div className="grid grid-cols-[1.3fr_1fr_1fr] gap-x-3 border-b border-line bg-bg/60 px-4 py-2.5 text-xs text-ink3">
          <span>{ev.po.id} · approved by {ev.po.approver}</span>
          <span>Invoice says</span>
          <span>Order says</span>
        </div>
        {ev.issues.map((x, i) => (
          <motion.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.07 }} className="grid grid-cols-[1.3fr_1fr_1fr] items-center gap-x-3 border-b border-line px-4 py-3 last:border-0">
            <span className="min-w-0 truncate">{x.desc}</span>
            <span className="num text-hold">{x.billed}</span>
            <span className="num">{x.expected}</span>
          </motion.div>
        ))}
        <div className="flex justify-between bg-bg/60 px-4 py-2.5 text-xs text-ink2">
          <span>Order total <span className="num text-ink">{usd(ev.po.total)}</span></span>
          <span>Invoice total <span className="num text-ink">{usd(invoice.amount)}</span></span>
        </div>
      </div>
    );
  }

  // bank
  const c = ev.change;
  const fromDomain = c?.from.split("@")[1];
  return (
    <div className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-4">
          <p className="text-xs text-ink3">{c ? "Account before the change" : "Account on the vendor record"}</p>
          <p className="mt-1 text-sm">{(c?.old ?? ev.onFile).name}</p>
          <p className="num text-lg">•••• {(c?.old ?? ev.onFile).last4}</p>
        </div>
        <div className="rounded-2xl border border-hold/30 bg-holdsoft p-4">
          <p className="text-xs text-hold">{c ? "Account this payment would go to" : "Account the invoice asks for"}</p>
          <p className="mt-1 text-sm">{c ? c.new.name : "Not on file"}</p>
          <p className="num text-lg">•••• {c ? c.new.last4 : ev.invoiceLast4}</p>
        </div>
      </div>
      {c && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }} className="rounded-2xl border border-line bg-surface p-4 text-sm">
          <p className="flex items-center gap-2 text-xs text-ink3">
            <Mail size={13} /> Email received {fmtDate(c.date)}
          </p>
          <p className="mt-2 font-medium">{c.subject}</p>
          <p className="mt-1 text-xs">
            <span className="text-ink3">From </span>
            <span className="num">
              {c.from.split("@")[0]}@<mark className="rounded bg-hold px-1 text-white">{fromDomain}</mark>
            </span>
          </p>
          <p className="text-xs">
            <span className="text-ink3">Vendor's real domain </span>
            <span className="num">{vendor.domain}</span>
          </p>
          <p className="mt-3 border-l-2 border-line2 pl-3 leading-relaxed text-ink2">{c.body}</p>
          <p className="mt-3 text-xs text-ink3">Callback verification: {c.verified === "none" ? "never done" : "done"}</p>
        </motion.div>
      )}
    </div>
  );
}

function SpanRow({ span }: { span: Span }) {
  const [open, setOpen] = useState(false);
  const Icon = span.type === "tool" ? Wrench : span.type === "model" ? Cpu : Gavel;
  return (
    <li className="border-b border-line last:border-0">
      <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm">
        <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${span.flagged ? "bg-holdsoft text-hold" : "bg-bg text-ink2"}`}>
          <Icon size={13} />
        </span>
        <span className="num min-w-0 flex-1 truncate">{span.name}</span>
        {span.error && <span className="text-xs text-hold">fell back</span>}
        {span.flagged && span.type === "tool" && <span className="rounded-full bg-holdsoft px-2 py-0.5 text-[10px] font-medium text-hold">problem found</span>}
        {span.type !== "decision" && <span className="num text-xs text-ink3">{span.ms < 1 ? "<1 ms" : `${Math.round(span.ms)} ms`}</span>}
        <motion.span animate={{ rotate: open ? 180 : 0 }} className="text-ink3">
          <ChevronDown size={14} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
            <pre className="scroll-thin num mx-4 mb-3 overflow-x-auto rounded-xl bg-bg p-3 text-[11px] leading-relaxed text-ink2">
              {JSON.stringify(span.error ? { error: span.error } : { input: span.input, output: span.output }, null, 2)}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}
