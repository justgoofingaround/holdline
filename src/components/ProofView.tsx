"use client";
import { motion } from "motion/react";
import { ArrowRight, RotateCcw, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { EvalReport } from "@/lib/types";
import { EASE, RULES, RULE_ORDER, RuleChip, Ticker, usd, usd0 } from "./ui";

const pct = (n: number) => `${Math.round(n * 100)}%`;
const whole = (n: number) => String(Math.round(n));

export function ProofView() {
  const [reports, setReports] = useState<EvalReport[] | null>(null);
  const [payments, setPayments] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runs, setRuns] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/eval", { cache: "no-store" });
      if (!res.ok) throw new Error(`Test run failed (${res.status})`);
      const json = await res.json();
      setReports(json.reports);
      setPayments(json.payments);
      setRuns((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Test run failed");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const v1 = reports?.find((r) => r.version === "v1");
  const v2 = reports?.find((r) => r.version === "v2");

  return (
    <div className="pt-4 sm:pt-8">
      <p className="eyebrow">Before and after</p>
      <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
        <h1 className="max-w-[18ch] font-serif text-[clamp(38px,7vw,84px)] leading-[0.95] tracking-[-0.02em]">
          Same payments. <em className="text-ink2">Same traps.</em> Two agents.
        </h1>
        <motion.button whileTap={{ scale: 0.97 }} onClick={load} disabled={loading} className="inline-flex h-12 items-center gap-2 rounded-full border border-line2 px-5 text-sm transition-colors hover:bg-surface disabled:opacity-60">
          <motion.span animate={loading ? { rotate: -360 } : { rotate: 0 }} transition={loading ? { repeat: Infinity, duration: 0.9, ease: "linear" } : { duration: 0 }}>
            <RotateCcw size={15} />
          </motion.span>
          {loading ? "Running tests" : "Re-run the tests"}
        </motion.button>
      </div>
      <p className="mt-4 max-w-[62ch] text-ink2">
        {payments || 120} payments with {v2?.planted ?? 25} problems planted in them, plus a handful of look-alikes that are legitimate. Each agent version is scored against the answer key.
      </p>
      {error && <p className="mt-4 text-sm text-hold">{error}</p>}

      {v1 && v2 && (
        <div key={runs}>
          <div className="mt-8 grid grid-cols-[minmax(0,1fr)] items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <Scorecard r={v1} title="Agent v1" sub="Exact invoice numbers, header totals, vendor record only" delay={0} />
            <motion.div initial={{ opacity: 0, scale: 0.6 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.5, type: "spring", stiffness: 300, damping: 20 }} className="grid place-items-center">
              <span className="grid size-11 rotate-90 place-items-center rounded-full bg-ink text-bg lg:rotate-0">
                <ArrowRight size={18} />
              </span>
            </motion.div>
            <Scorecard r={v2} title="Agent v2" sub="Normalised numbers, line-level match, change history, split detection" delay={0.25} strong />
          </div>

          {v2.engine === "llm" && (
            <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.9 }} className="mt-3 text-center text-sm text-ink2">
              The model disagreed with the checks on <span className="num text-ink">{v1.overruled + v2.overruled}</span> payment{v1.overruled + v2.overruled === 1 ? "" : "s"}; every time, the checks decided.
            </motion.p>
          )}
          <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="mt-5 text-center text-sm text-ink2">
            <span className="text-ink">+{v2.caught - v1.caught} problems caught</span> and <span className="num text-ink">{usd0(v2.exposureCaught - v1.exposureCaught)}</span> more stopped, at the cost of {v2.falsePositives - v1.falsePositives} extra false alarms.
          </motion.p>

          <section className="mt-8 rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-medium">Planted problems caught, by type</h2>
              <div className="flex items-center gap-4 text-xs text-ink2">
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-[3px] bg-ink3/45" /> Agent v1</span>
                <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-5 rounded-[3px] bg-ink" /> Agent v2</span>
              </div>
            </div>
            <div className="mt-5 grid gap-x-10 gap-y-6 md:grid-cols-2">
              {RULE_ORDER.map((rule, i) => {
                const a = v1.byCategory.find((c) => c.rule === rule)!;
                const b = v2.byCategory.find((c) => c.rule === rule)!;
                const Icon = RULES[rule].icon;
                return (
                  <div key={rule}>
                    <p className="mb-2 flex items-center gap-2 text-sm">
                      <Icon size={14} className="text-ink2" /> {RULES[rule].label}
                      <span className="text-ink3">· {a.planted} planted</span>
                    </p>
                    <Bar caught={a.caught} planted={a.planted} label="v1" delay={0.3 + i * 0.08} />
                    <Bar caught={b.caught} planted={b.planted} label="v2" delay={0.45 + i * 0.08} strong />
                  </div>
                );
              })}
            </div>
          </section>

          <div className="mt-6 grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2">
            <Issues title="What v2 still misses" empty="Nothing missed." rows={v2.misses} />
            <Issues title="False alarms in v2" empty="No false alarms." rows={v2.fps} />
          </div>

          <p className="mt-6 flex items-start gap-2 text-xs leading-relaxed text-ink3">
            <TriangleAlert size={14} className="mt-0.5 shrink-0" />
            These scores are from synthetic data whose planted cases were known while the checks were written, so treat them as a regression test, not a field result. Generate a fresh run with a new seed (or have someone else plant the cases) for an unseen test.
          </p>
        </div>
      )}

      {!reports && loading && (
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {[0, 1].map((i) => (
            <motion.div key={i} animate={{ opacity: [0.4, 0.8, 0.4] }} transition={{ repeat: Infinity, duration: 1.4, delay: i * 0.2 }} className="h-64 rounded-3xl border border-line bg-surface" />
          ))}
        </div>
      )}
    </div>
  );
}

function Scorecard({ r, title, sub, delay, strong }: { r: EvalReport; title: string; sub: string; delay: number; strong?: boolean }) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.6, ease: EASE }}
      className={`rounded-3xl border p-5 shadow-card sm:p-7 ${strong ? "border-ink bg-ink text-bg" : "border-line bg-surface"}`}
    >
      <p className="text-sm font-medium">{title}</p>
      <p className={`mt-1 text-[13px] leading-snug ${strong ? "text-bg/60" : "text-ink3"}`}>{sub}</p>
      <p className="mt-6 font-serif text-[clamp(64px,10vw,112px)] leading-[0.85]">
        <CountUp to={r.caught} delay={delay} />
        <span className={`text-[0.45em] ${strong ? "text-bg/50" : "text-ink3"}`}> / {r.planted}</span>
      </p>
      <p className={`mt-2 text-sm ${strong ? "text-bg/70" : "text-ink2"}`}>planted problems caught</p>
      <dl className={`mt-6 grid grid-cols-3 gap-3 border-t pt-4 text-sm ${strong ? "border-bg/20" : "border-line"}`}>
        {[
          ["Stopped", usd0(r.exposureCaught), `of ${usd0(r.exposureTotal)} at risk`],
          ["Recall", pct(r.recall), "of problems found"],
          ["False alarms", String(r.falsePositives), `precision ${pct(r.precision)}`],
        ].map(([k, v, note]) => (
          <div key={k} className="min-w-0">
            <dt className={`text-xs ${strong ? "text-bg/55" : "text-ink3"}`}>{k}</dt>
            <dd className="num mt-1 truncate text-base sm:text-lg">{v}</dd>
            <dd className={`text-[11px] leading-tight ${strong ? "text-bg/45" : "text-ink3"}`}>{note}</dd>
          </div>
        ))}
      </dl>
    </motion.section>
  );
}

function CountUp({ to, delay }: { to: number; delay: number }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setV(to), delay * 1000 + 250);
    return () => clearTimeout(t);
  }, [to, delay]);
  return <Ticker value={v} format={whole} />;
}

function Bar({ caught, planted, label, delay, strong }: { caught: number; planted: number; label: string; delay: number; strong?: boolean }) {
  return (
    <div className="group mt-1.5 flex items-center gap-3" title={`Agent ${label}: ${caught} of ${planted} caught`}>
      <span className="w-5 text-xs text-ink3">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded-full bg-track">
        <motion.div
          initial={{ width: 0 }} animate={{ width: `${(caught / planted) * 100}%` }} transition={{ delay, duration: 0.8, ease: EASE }}
          className={`h-full rounded-full transition-opacity group-hover:opacity-80 ${strong ? "bg-ink" : "bg-ink3/45"}`}
        />
      </div>
      <span className="num w-9 text-right text-xs text-ink2">
        {caught}/{planted}
      </span>
    </div>
  );
}

function Issues({ title, rows, empty }: { title: string; rows: EvalReport["misses"]; empty: string }) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 shadow-card sm:p-7">
      <h2 className="text-sm font-medium">
        {title} <span className="num ml-1 text-ink3">{rows.length}</span>
      </h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink2">{empty}</p>
      ) : (
        <ul className="mt-3">
          {rows.map((m, i) => (
            <motion.li key={m.invoiceId} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.6 + i * 0.07 }} className="border-b border-line py-3 last:border-0">
              <div className="flex items-center justify-between gap-3">
                <span className="flex min-w-0 items-center gap-2">
                  <RuleChip rule={m.rule} quiet />
                  <span className="truncate text-sm">{m.vendor}</span>
                </span>
                <span className="num shrink-0 text-sm">{usd(m.amount)}</span>
              </div>
              <p className="mt-1.5 text-[13px] leading-snug text-ink2">{m.note}</p>
            </motion.li>
          ))}
        </ul>
      )}
    </section>
  );
}
