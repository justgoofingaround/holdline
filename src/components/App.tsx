"use client";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion/react";
import { Moon, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentVersion, Dataset, QueueItem, RunEvent, Verdict } from "@/lib/types";
import { AskPanel } from "./AskPanel";
import { CallModal } from "./CallModal";
import { HoldDrawer } from "./HoldDrawer";
import { KnowledgeView, type KBData, type KBFocus } from "./KnowledgeView";
import { ProofView } from "./ProofView";
import { RunView } from "./RunView";
import { EASE, SPRING } from "./ui";

export type Phase = "idle" | "running" | "done";
/** What a person decided about a held payment. */
export type Resolution = "held" | "released" | "fraud" | "verified";

type Props = { meta: Dataset["meta"]; queue: QueueItem[]; model: string | null; kb: KBData };
const TABS = { run: "Payment run", kb: "Knowledge base", proof: "Proof" } as const;

export default function App({ meta, queue, model, kb }: Props) {
  const [view, setView] = useState<keyof typeof TABS>("run");
  const [kbFocus, setKbFocus] = useState<KBFocus | null>(null);
  const [version, setVersion] = useState<AgentVersion>("v2");
  const [phase, setPhase] = useState<Phase>("idle");
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [arrivals, setArrivals] = useState<string[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = useRef<EventSource | null>(null);

  const byId = useMemo(() => new Map(queue.map((q) => [q.invoice.id, q])), [queue]);

  const reset = useCallback(() => {
    source.current?.close();
    setPhase("idle");
    setVerdicts({});
    setArrivals([]);
    setResolutions({});
    setOpenId(null);
    setError(null);
  }, []);

  const run = useCallback(() => {
    reset();
    setPhase("running");
    const es = new EventSource(`/api/run?version=${version}`);
    source.current = es;
    es.onmessage = (m) => {
      const e = JSON.parse(m.data) as RunEvent;
      if (e.type === "verdict") {
        setVerdicts((v) => ({ ...v, [e.verdict.invoiceId]: e.verdict }));
        setArrivals((a) => [...a, e.verdict.invoiceId]);
      } else if (e.type === "done") {
        es.close();
        setPhase("done");
      }
    };
    es.onerror = () => {
      es.close();
      setError("Lost the connection to the agent. Run it again.");
      setPhase("idle");
    };
  }, [reset, version]);

  useEffect(() => () => source.current?.close(), []);

  const changeVersion = (v: AgentVersion) => {
    if (v === version) return;
    setVersion(v);
    reset();
  };

  const open = openId ? byId.get(openId) : undefined;
  const call = callId ? byId.get(callId) : undefined;

  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.45, ease: EASE }}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[1320px] flex-col px-4 sm:px-8">
        <header className="flex flex-wrap items-center gap-x-4 gap-y-3 py-5">
          <a href="#" className="flex items-center gap-2.5" aria-label="Holdline">
            <Mark />
            <span className="font-serif text-[26px] leading-none tracking-tight">Holdline</span>
          </a>

          <LayoutGroup id="tabs">
            <nav className="order-3 flex w-full rounded-full border border-line bg-surface p-1 sm:order-none sm:ml-6 sm:w-auto" aria-label="Views">
              {(Object.keys(TABS) as (keyof typeof TABS)[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setView(t)}
                  aria-current={view === t}
                  className={`relative flex-1 whitespace-nowrap rounded-full px-2.5 py-1.5 text-[13px] transition-colors sm:flex-none sm:px-4 sm:text-sm ${view === t ? "text-bg" : "text-ink2 hover:text-ink"}`}
                >
                  {view === t && <motion.span layoutId="tab-pill" className="absolute inset-0 rounded-full bg-ink" transition={SPRING} />}
                  <span className="relative">{TABS[t]}</span>
                </button>
              ))}
            </nav>
          </LayoutGroup>

          <div className="ml-auto flex items-center gap-2">
            <span className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink2 md:inline-flex" title={model ? "Decisions are made by the model through tool calls" : "No model key set: decisions come from the rules engine"}>
              <span className={`size-1.5 rounded-full ${model ? "bg-okfill" : "bg-ink3"}`} />
              {model ? model : "Rules engine"}
            </span>
            <LayoutGroup id="version">
              <div className="flex rounded-full border border-line bg-surface p-1" role="group" aria-label="Agent version">
                {(["v1", "v2"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => changeVersion(v)}
                    aria-pressed={version === v}
                    disabled={phase === "running"}
                    className={`relative rounded-full px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${version === v ? "text-ink" : "text-ink3 hover:text-ink"}`}
                  >
                    {version === v && <motion.span layoutId="ver-pill" className="absolute inset-0 rounded-full border border-line2 bg-raised" transition={SPRING} />}
                    <span className="relative">{v === "v1" ? "Agent v1" : "Agent v2"}</span>
                  </button>
                ))}
              </div>
            </LayoutGroup>
            <ThemeToggle />
          </div>
        </header>

        <main className="flex-1 pb-16">
          <AnimatePresence mode="wait" initial={false}>
            {view === "run" ? (
              <motion.div key="run" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}>
                <RunView
                  meta={meta} queue={queue} phase={phase} version={version} verdicts={verdicts} arrivals={arrivals}
                  resolutions={resolutions} error={error} onRun={run} onReset={reset} onOpen={setOpenId} onProof={() => setView("proof")}
                />
              </motion.div>
            ) : view === "kb" ? (
              <motion.div key="kb" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}>
                <KnowledgeView kb={kb} version={version} focus={kbFocus} />
              </motion.div>
            ) : (
              <motion.div key="proof" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}>
                <ProofView />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line py-5 text-xs text-ink3">
          <span>Synthetic data. {queue.length} payments, 25 planted problems, answer key in the repo.</span>
          <span>Built for Money Talks #3</span>
        </footer>
      </div>

      <AnimatePresence>
        {open && verdicts[open.invoice.id] && (
          <HoldDrawer
            key="drawer" item={open} verdict={verdicts[open.invoice.id]} resolution={resolutions[open.invoice.id] ?? "held"}
            onClose={() => setOpenId(null)}
            onResolve={(r) => setResolutions((s) => ({ ...s, [open.invoice.id]: r }))}
            onCall={() => setCallId(open.invoice.id)}
            onShowRecords={() => {
              setKbFocus({ vendorId: open.vendor.id, invoiceId: open.invoice.id, n: Date.now() });
              setOpenId(null);
              setView("kb");
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
          />
        )}
      </AnimatePresence>
      <AskPanel />
      <AnimatePresence>
        {call && verdicts[call.invoice.id] && (
          <CallModal
            key="call" item={call} verdict={verdicts[call.invoice.id]} company={meta.company}
            onClose={() => setCallId(null)}
            onOutcome={(r) => setResolutions((s) => ({ ...s, [call.invoice.id]: r }))}
          />
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}

function Mark() {
  return (
    <span className="relative grid size-8 place-items-center rounded-[10px] bg-ink" aria-hidden>
      <span className="h-[3px] w-4 rounded-full bg-bg" />
      <span className="absolute right-[5px] top-[5px] size-[5px] rounded-full bg-hold" />
    </span>
  );
}

function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const saved = document.documentElement.dataset.theme;
    setDark(saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("holdline-theme", next ? "dark" : "light");
    } catch {}
  };
  return (
    <button onClick={toggle} aria-label="Switch colour theme" className="grid size-9 place-items-center overflow-hidden rounded-full border border-line bg-surface text-ink2 transition-colors hover:text-ink">
      <AnimatePresence mode="wait" initial={false}>
        <motion.span key={dark ? "moon" : "sun"} initial={{ y: 12, opacity: 0, rotate: -40 }} animate={{ y: 0, opacity: 1, rotate: 0 }} exit={{ y: -12, opacity: 0, rotate: 40 }} transition={{ duration: 0.22 }}>
          {dark ? <Moon size={15} /> : <Sun size={15} />}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
