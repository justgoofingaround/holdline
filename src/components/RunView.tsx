"use client";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ArrowRight, Check, CircleCheck, Minus, Play, RotateCcw, ShieldAlert, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { AgentVersion, Dataset, QueueItem, Rule, Verdict } from "@/lib/types";
import type { Phase, Resolution } from "./App";
import { EASE, RULES, RULE_ORDER, RuleChip, SPRING, Ticker, fmtDate, usd, usd0 } from "./ui";

type Props = {
  meta: Dataset["meta"];
  queue: QueueItem[];
  phase: Phase;
  version: AgentVersion;
  verdicts: Record<string, Verdict>;
  arrivals: string[];
  resolutions: Record<string, Resolution>;
  error: string | null;
  onRun: () => void;
  onReset: () => void;
  onOpen: (id: string) => void;
  onProof: () => void;
};

const count = (n: number) => String(Math.round(n));

export function RunView({ meta, queue, phase, version, verdicts, arrivals, resolutions, error, onRun, onReset, onOpen, onProof }: Props) {
  const [filter, setFilter] = useState<Rule | "all">("all");
  const byId = useMemo(() => new Map(queue.map((q) => [q.invoice.id, q])), [queue]);
  const total = useMemo(() => queue.reduce((a, q) => a + q.invoice.amount, 0), [queue]);

  const stats = useMemo(() => {
    let released = 0, held = 0, heldCount = 0, exposure = 0;
    for (const id of arrivals) {
      const v = verdicts[id];
      const amt = byId.get(id)!.invoice.amount;
      const r = resolutions[id] ?? "held";
      if (v.decision === "hold" && (r === "held" || r === "fraud")) {
        held += amt;
        heldCount++;
        exposure += v.exposure;
      } else released += amt;
    }
    return { released, held, heldCount, exposure, checked: arrivals.length };
  }, [arrivals, verdicts, resolutions, byId]);

  const holds = useMemo(
    () => arrivals.filter((id) => verdicts[id].decision === "hold").map((id) => ({ item: byId.get(id)!, verdict: verdicts[id] })),
    [arrivals, verdicts, byId],
  );
  const ruleCounts = useMemo(() => {
    const c = {} as Record<Rule, number>;
    for (const h of holds) c[h.verdict.signals[0].rule] = (c[h.verdict.signals[0].rule] ?? 0) + 1;
    return c;
  }, [holds]);
  const shown = holds.filter((h) => filter === "all" || h.verdict.signals[0].rule === filter).reverse();
  const feed = arrivals.slice(-7).reverse();
  const current = phase === "running" ? queue[Math.min(arrivals.length, queue.length - 1)]?.invoice.id : null;

  return (
    <div className="pt-4 sm:pt-8">
      {/* ---------------- hero ---------------- */}
      <section>
        <p className="eyebrow">
          {meta.company} · Payment run {meta.runId} · {fmtDate(meta.runDate)}
        </p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
          <div className="min-w-0">
            <h1 className="font-serif text-[clamp(44px,9vw,112px)] leading-[0.92] tracking-[-0.02em]">{usd(total)}</h1>
            <div className="mt-3 min-h-14 text-[17px] text-ink2 sm:min-h-7 sm:text-lg">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p key={phase} initial={{ y: 22, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -22, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }}>
                  {phase === "idle" && <>is set to leave the bank today, across {queue.length} payments.</>}
                  {phase === "running" && (
                    <>
                      Checking payment <span className="num text-ink">{Math.min(stats.checked + 1, queue.length)}</span> of {queue.length}…
                    </>
                  )}
                  {phase === "done" && (
                    <>
                      checked. <span className="text-ink">{stats.heldCount} payments held</span> before the money moved.
                    </>
                  )}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {phase !== "idle" && (
              <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} onClick={onReset} className="inline-flex h-12 items-center gap-2 rounded-full border border-line2 px-5 text-sm text-ink2 transition-colors hover:text-ink">
                <RotateCcw size={15} /> Reset
              </motion.button>
            )}
            {phase === "done" ? (
              <motion.button initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={onProof} className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-sm font-medium text-bg">
                See the proof <ArrowRight size={16} />
              </motion.button>
            ) : (
              <motion.button
                whileHover={phase === "idle" ? { scale: 1.03 } : undefined} whileTap={{ scale: 0.97 }} onClick={onRun} disabled={phase === "running"}
                className={`relative inline-flex h-12 items-center gap-2.5 overflow-hidden rounded-full bg-ink px-6 text-sm font-medium text-bg disabled:cursor-progress ${phase === "idle" ? "sheen" : ""}`}
              >
                {phase === "running" ? (
                  <>
                    <Spinner /> Agent {version} is checking
                  </>
                ) : (
                  <>
                    <Play size={15} fill="currentColor" /> Run pre-payment check
                  </>
                )}
              </motion.button>
            )}
          </div>
        </div>
        {error && <p className="mt-3 text-sm text-hold">{error}</p>}

        {/* the line: where the money went */}
        <div className="mt-8 flex h-3.5 gap-[2px] overflow-hidden rounded-full bg-track" role="img" aria-label={`${usd0(stats.released)} released, ${usd0(stats.held)} held`}>
          <motion.div className="h-full rounded-full bg-okfill" initial={false} animate={{ width: `${(stats.released / total) * 100}%` }} transition={{ duration: 0.5, ease: EASE }} />
          <motion.div className="h-full rounded-full bg-hold" initial={false} animate={{ width: `${(stats.held / total) * 100}%` }} transition={{ duration: 0.5, ease: EASE }} />
        </div>

        <div className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          <Stat label="Checked" value={stats.checked} format={count} suffix={` / ${queue.length}`} />
          <Stat label="Released" value={stats.released} format={usd0} icon={<CircleCheck size={14} className="text-ok" />} />
          <Stat label="Held" value={stats.held} format={usd0} icon={<ShieldAlert size={14} className="text-hold" />} suffix={stats.heldCount ? ` · ${stats.heldCount}` : ""} />
          <Stat label="Money at risk stopped" value={stats.exposure} format={usd0} strong />
        </div>
      </section>

      {/* ---------------- every payment in the run ---------------- */}
      <section className="mt-9 rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Every payment in this run</h2>
          <div className="flex items-center gap-4 text-xs text-ink2">
            <Legend className="border border-line2" label="Queued" />
            <Legend className="bg-okfill" label="Released" icon={<Check size={9} strokeWidth={3.5} className="text-white" />} />
            <Legend className="bg-hold" label="Held" icon={<Minus size={9} strokeWidth={4} className="text-white" />} />
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(26px,1fr))] gap-1.5 sm:grid-cols-[repeat(auto-fill,minmax(34px,1fr))] sm:gap-2">
          {queue.map(({ invoice, vendor }) => {
            const v = verdicts[invoice.id];
            const r = resolutions[invoice.id] ?? "held";
            const held = v?.decision === "hold" && (r === "held" || r === "fraud");
            const state = !v ? (current === invoice.id ? "checking" : "queued") : held ? "held" : "released";
            return (
              <button
                key={invoice.id}
                disabled={v?.decision !== "hold"}
                onClick={() => onOpen(invoice.id)}
                title={`${vendor.name} · ${invoice.invoiceNumber} · ${usd(invoice.amount)}${v ? (held ? " · held" : " · released") : ""}`}
                className="group relative aspect-square disabled:cursor-default"
              >
                <span
                  className={`absolute inset-0 grid place-items-center rounded-[7px] transition-[background-color,border-color,transform] duration-300 ${
                    state === "queued" ? "border border-line2" : state === "checking" ? "border border-ink bg-ink/10" : state === "held" ? "bg-hold group-hover:scale-110" : v?.decision === "hold" ? "bg-okfill/70 group-hover:scale-110" : "bg-okfill/85"
                  }`}
                  style={state === "checking" ? { animation: "tile-check 0.5s ease-in-out infinite" } : undefined}
                >
                  {v && (
                    <motion.span initial={{ scale: 0, rotate: -30 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: "spring", stiffness: 520, damping: 22 }}>
                      {held ? <Minus size={13} strokeWidth={4} className="text-white" /> : <Check size={12} strokeWidth={3.5} className="text-white" />}
                    </motion.span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---------------- live feed + holds ---------------- */}
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium">{phase === "idle" ? "Next in the queue" : "Agent activity"}</h2>
            {phase === "running" && (
              <span className="inline-flex items-center gap-2 text-xs text-ink2">
                <span className="relative flex size-2">
                  <span className="absolute inset-0 rounded-full bg-hold" style={{ animation: "ring 1.2s ease-out infinite" }} />
                  <span className="relative size-2 rounded-full bg-hold" />
                </span>
                Live
              </span>
            )}
          </div>
          <ul className="relative h-[392px] overflow-hidden">
            <>
              {(phase === "idle" ? queue.slice(0, 7).map((q) => q.invoice.id) : feed).map((id) => {
                const { invoice, vendor } = byId.get(id)!;
                const v = verdicts[id];
                return (
                  <motion.li
                    key={id} layout
                    initial={phase === "idle" ? false : { opacity: 0, y: -18 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, ease: EASE }}
                    className="flex h-14 items-center gap-3 border-b border-line last:border-0"
                  >
                    <span className={`grid size-7 shrink-0 place-items-center rounded-full ${!v ? "border border-line2 text-ink3" : v.decision === "hold" ? "bg-hold text-white" : "bg-oksoft text-ok"}`}>
                      {!v ? <span className="size-1 rounded-full bg-ink3" /> : v.decision === "hold" ? <Minus size={14} strokeWidth={3.5} /> : <Check size={14} strokeWidth={3} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{vendor.name}</p>
                      <p className="num truncate text-[11px] text-ink3">{invoice.invoiceNumber}</p>
                    </div>
                    {v ? (
                      <span className="hidden items-center gap-1 sm:flex" aria-label={`${v.spans.length - 1} checks`}>
                        {v.spans.filter((s) => s.type === "tool").map((s, i) => (
                          <motion.span key={s.id} title={s.name} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.05 * i, type: "spring", stiffness: 500, damping: 20 }} className={`size-1.5 rounded-full ${s.flagged ? "bg-hold" : "bg-ink3/50"}`} />
                        ))}
                      </span>
                    ) : null}
                    {v?.decision === "hold" ? <RuleChip rule={v.signals[0].rule} /> : null}
                    <span className="num w-[92px] shrink-0 text-right text-sm">{usd(invoice.amount)}</span>
                  </motion.li>
                );
              })}
            </>
          </ul>
        </section>

        <section className="rounded-3xl border border-line bg-surface p-4 shadow-card sm:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium">
              Held for review
              {holds.length > 0 && <span className="num ml-2 rounded-full bg-holdsoft px-2 py-0.5 text-[11px] text-hold">{holds.length}</span>}
            </h2>
            {holds.length > 0 && (
              <LayoutGroup id="filters">
                <div className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 scroll-thin">
                  {(["all", ...RULE_ORDER.filter((r) => ruleCounts[r])] as const).map((r) => (
                    <button key={r} onClick={() => setFilter(r)} aria-pressed={filter === r} className={`relative shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors ${filter === r ? "text-bg" : "text-ink2 hover:text-ink"}`}>
                      {filter === r && <motion.span layoutId="filter-pill" className="absolute inset-0 rounded-full bg-ink" transition={SPRING} />}
                      <span className="relative">
                        {r === "all" ? "All" : RULES[r].short}
                        {r !== "all" && <span className="num ml-1.5 opacity-60">{ruleCounts[r]}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </LayoutGroup>
            )}
          </div>

          {holds.length === 0 ? (
            <div className="grid min-h-[392px] content-center gap-3">
              <p className="mb-1 flex items-center gap-2 text-sm text-ink2">
                <ShieldCheck size={16} /> {phase === "idle" ? "Four checks run on every payment before it is released." : "Nothing held yet."}
              </p>
              {RULE_ORDER.map((r, i) => {
                const { label, icon: Icon, blurb } = RULES[r];
                return (
                  <motion.div key={r} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.08 * i + 0.1, duration: 0.5, ease: EASE }} className="flex items-start gap-3 rounded-2xl border border-line p-3.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-bg text-ink">
                      <Icon size={16} />
                    </span>
                    <div>
                      <p className="text-sm font-medium">{label}</p>
                      <p className="text-[13px] leading-snug text-ink2">{blurb}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <ul className="scroll-thin -mr-2 grid max-h-[560px] min-h-[392px] content-start gap-2.5 overflow-y-auto pr-2">
              <AnimatePresence initial={false} mode="popLayout">
                {shown.map(({ item, verdict }) => {
                  const r = resolutions[item.invoice.id] ?? "held";
                  return (
                    <motion.li key={item.invoice.id} layout initial={{ opacity: 0, x: 28, scale: 0.96 }} animate={{ opacity: 1, x: 0, scale: 1 }} exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }} transition={SPRING}>
                      <motion.button
                        whileHover={{ y: -2 }} whileTap={{ scale: 0.985 }} onClick={() => onOpen(item.invoice.id)}
                        className={`group w-full rounded-2xl border bg-raised p-4 text-left transition-[border-color,box-shadow] hover:border-line2 hover:shadow-card ${r === "released" || r === "verified" ? "border-line opacity-60" : "border-line"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {verdict.signals.map((s) => (
                                <RuleChip key={s.rule} rule={s.rule} />
                              ))}
                              <ResolutionTag r={r} />
                            </div>
                            <p className="mt-2 truncate text-[15px] font-medium">{item.vendor.name}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="num text-[15px]">{usd(item.invoice.amount)}</p>
                            <p className="num text-[11px] text-ink3">{item.invoice.invoiceNumber}</p>
                          </div>
                        </div>
                        <p className="mt-2 line-clamp-2 text-[13px] leading-snug text-ink2">{verdict.signals[0].detail}</p>
                        <p className="mt-2.5 flex items-center justify-between text-xs text-ink3">
                          <span>
                            At risk <span className="num text-ink">{usd(verdict.exposure)}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-ink2 transition-transform group-hover:translate-x-0.5">
                            Evidence <ArrowRight size={12} />
                          </span>
                        </p>
                      </motion.button>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

export function ResolutionTag({ r }: { r: Resolution }) {
  if (r === "held") return null;
  const map = { released: ["Released by reviewer", "border-line text-ink2"], verified: ["Verified by call · released", "bg-oksoft text-ok"], fraud: ["Fraud confirmed · blocked", "bg-hold text-white"] } as const;
  const [text, cls] = map[r];
  return <span className={`rounded-full border border-transparent px-2.5 py-1 text-[11px] font-medium leading-none ${cls}`}>{text}</span>;
}

function Stat({ label, value, format, suffix, icon, strong }: { label: string; value: number; format: (n: number) => string; suffix?: string; icon?: React.ReactNode; strong?: boolean }) {
  return (
    <div className={strong ? "border-l-2 border-ink pl-4" : "border-l border-line pl-4"}>
      <p className="flex items-center gap-1.5 text-xs text-ink2">
        {icon}
        {label}
      </p>
      <p className="mt-1 font-serif text-[clamp(26px,4vw,40px)] leading-none">
        <Ticker value={value} format={format} />
        {suffix && <span className="font-sans text-sm text-ink3">{suffix}</span>}
      </p>
    </div>
  );
}

function Legend({ className, label, icon }: { className: string; label: string; icon?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`grid size-3.5 place-items-center rounded-[4px] ${className}`}>{icon}</span>
      {label}
    </span>
  );
}

function Spinner() {
  return (
    <motion.span className="size-3.5 rounded-full border-2 border-bg/30 border-t-bg" animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 0.8, ease: "linear" }} />
  );
}
