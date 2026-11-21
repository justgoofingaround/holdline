"use client";
import { AnimatePresence, motion } from "motion/react";
import { Phone, PhoneOff, ShieldAlert, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { QueueItem, Verdict } from "@/lib/types";
import type { Resolution } from "./App";
import { EASE, fmtDate, usd } from "./ui";

type Props = { item: QueueItem; verdict: Verdict; company: string; onClose: () => void; onOutcome: (r: Resolution) => void };
type Line = { who: "agent" | "vendor"; text: string };
type Stage = "dialing" | "speaking" | "awaiting" | "closing" | "ended";

const digits = (s: string) => s.split("").join(" ");

export function CallModal({ item, verdict, company, onClose, onOutcome }: Props) {
  const { vendor, invoice } = item;
  const ev = verdict.signals.find((s) => s.rule === "bank_change")?.evidence;
  const change = ev?.kind === "bank" ? ev.change : null;

  const [stage, setStage] = useState<Stage>("dialing");
  const [lines, setLines] = useState<Line[]>([]);
  const [talking, setTalking] = useState(false);
  const [voice, setVoice] = useState<"elevenlabs" | "browser" | "silent" | null>(null);
  const [outcome, setOutcome] = useState<"fraud" | "verified" | null>(null);
  const alive = useRef(true);
  const runId = useRef(0);
  const audio = useRef<HTMLAudioElement | null>(null);

  /** Speak one line: ElevenLabs if the server has a key, otherwise the browser's own voice. */
  const speak = useCallback(async (text: string) => {
    setTalking(true);
    try {
      const res = await fetch("/api/voice", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (res.status === 200 && alive.current) {
        setVoice("elevenlabs");
        const url = URL.createObjectURL(await res.blob());
        await new Promise<void>((done) => {
          const a = new Audio(url);
          audio.current = a;
          a.onended = a.onerror = () => done();
          a.play().catch(() => done());
        });
        URL.revokeObjectURL(url);
      } else if (alive.current && "speechSynthesis" in window) {
        setVoice("browser");
        await new Promise<void>((done) => {
          const u = new SpeechSynthesisUtterance(text);
          u.rate = 1.05;
          u.onend = u.onerror = () => done();
          window.speechSynthesis.speak(u);
          setTimeout(done, 3000 + text.length * 90); // safety net if the browser never fires onend
        });
      } else {
        setVoice("silent");
        await new Promise((r) => setTimeout(r, 900 + text.length * 35));
      }
    } catch {
      await new Promise((r) => setTimeout(r, 900 + text.length * 35));
    }
    if (alive.current) setTalking(false);
  }, []);

  const say = useCallback(
    async (text: string) => {
      setLines((l) => [...l, { who: "agent", text }]);
      await speak(text);
    },
    [speak],
  );

  useEffect(() => {
    alive.current = true;
    const id = ++runId.current; // React runs effects twice in development; only the latest run may speak
    const live = () => alive.current && id === runId.current;
    const opening = `Hello, this is the accounts payable desk at ${company.replace("&", "and").replace(/\.$/, "")}. I'm calling ${vendor.name.replace("&", "and")} on the number we have on file, to verify a payment detail.`;
    const question = change
      ? `On ${fmtDate(change.date)} we received an email asking us to send your payments to a new account at ${change.new.name}, ending ${digits(change.new.last4)}. Did your company request that change?`
      : `We have an invoice, ${digits(invoice.invoiceNumber.replace("-", ""))}, asking for payment to an account ending ${digits(invoice.payToLast4)}. That is not the account we have on file. Did your company send it?`;
    (async () => {
      await new Promise((r) => setTimeout(r, 2200));
      if (!live()) return;
      setStage("speaking");
      await say(opening);
      if (!live()) return;
      await say(question);
      if (live()) setStage("awaiting");
    })();
    return () => {
      alive.current = false;
      audio.current?.pause();
      if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, [company, vendor.name, change, invoice.invoiceNumber, invoice.payToLast4, say]);

  const answer = async (confirmed: boolean) => {
    setStage("closing");
    setLines((l) => [...l, { who: "vendor", text: confirmed ? "Yes, that's right. We moved banks last month." : "No. We haven't changed our bank details. That did not come from us." }]);
    await new Promise((r) => setTimeout(r, 900));
    await say(
      confirmed
        ? "Thank you for confirming. I'll mark the change as verified and release the payment."
        : `Thank you. We will not pay that account. The payment of ${usd(invoice.amount)} stays on hold and I'm reporting the request as fraud.`,
    );
    if (!alive.current) return;
    const result = confirmed ? "verified" : "fraud";
    setOutcome(result);
    onOutcome(result);
    setStage("ended");
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end sm:place-items-center">
      <motion.div className="absolute inset-0 bg-black/60 backdrop-blur-md" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
      <motion.div
        role="dialog" aria-modal="true" aria-label="Callback verification"
        initial={{ opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.97 }} transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#121210] text-[#f2f0e9] shadow-2xl sm:w-[520px] sm:rounded-[28px]"
      >
        <div className="flex flex-col items-center px-6 pt-8 text-center">
          <div className="relative grid size-20 place-items-center">
            {(stage === "dialing" || talking) &&
              [0, 1, 2].map((i) => (
                <span key={i} className="absolute inset-0 rounded-full border border-white/40" style={{ animation: `ring 1.8s ease-out ${i * 0.6}s infinite` }} />
              ))}
            <motion.span
              animate={{ backgroundColor: outcome === "fraud" ? "#d03b3b" : outcome === "verified" ? "#0ca30c" : "#f2f0e9", color: outcome ? "#ffffff" : "#121210" }}
              className="relative grid size-20 place-items-center rounded-full"
            >
              {outcome === "fraud" ? <ShieldAlert size={30} /> : outcome === "verified" ? <ShieldCheck size={30} /> : <Phone size={28} />}
            </motion.span>
          </div>
          <p className="mt-5 font-serif text-3xl leading-tight">{vendor.name}</p>
          <p className="num mt-1 text-sm text-white/60">{vendor.phoneOnFile} · number on file</p>
          <div className="mt-2 h-5 text-xs text-white/50">
            <AnimatePresence mode="wait">
              <motion.span key={stage} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
                {stage === "dialing" && "Calling…"}
                {(stage === "speaking" || stage === "closing") && "Connected"}
                {stage === "awaiting" && "Waiting for the vendor's answer"}
                {stage === "ended" && "Call ended"}
              </motion.span>
            </AnimatePresence>
          </div>
          <div className="mt-3 flex h-8 items-center gap-[3px]" aria-hidden>
            {Array.from({ length: 28 }, (_, i) => (
              <span
                key={i} className="w-[3px] origin-center rounded-full bg-white/70 transition-opacity duration-300"
                style={{ height: 8 + ((i * 7) % 5) * 5, opacity: talking ? 1 : 0.18, animation: talking ? `wave ${0.5 + ((i * 3) % 5) * 0.09}s ease-in-out ${i * 0.03}s infinite` : "none", transform: talking ? undefined : "scaleY(0.25)" }}
              />
            ))}
          </div>
        </div>

        <div className="scroll-thin mt-4 flex min-h-[140px] flex-1 flex-col gap-2.5 overflow-y-auto px-5 pb-2 sm:px-6">
          <AnimatePresence initial={false}>
            {lines.map((l, i) => (
              <motion.p
                key={i} layout initial={{ opacity: 0, y: 14, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.4, ease: EASE }}
                className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${l.who === "agent" ? "self-start rounded-bl-md bg-white/10" : "self-end rounded-br-md bg-[#f2f0e9] text-[#121210]"}`}
              >
                <span className="mb-0.5 block text-[10px] uppercase tracking-widest opacity-55">{l.who === "agent" ? "Holdline agent" : "Vendor"}</span>
                {l.text}
              </motion.p>
            ))}
          </AnimatePresence>
        </div>

        <div className="border-t border-white/10 px-5 py-4 sm:px-6">
          <AnimatePresence mode="wait">
            {stage === "awaiting" ? (
              <motion.div key="answers" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <p className="mb-2 text-center text-[11px] text-white/50">Demo: you play the vendor. Choose their answer.</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <button onClick={() => answer(false)} className="h-11 rounded-full bg-[#d03b3b] px-4 text-sm font-medium text-white transition-transform active:scale-[0.97]">
                    “No, that wasn’t us”
                  </button>
                  <button onClick={() => answer(true)} className="h-11 rounded-full border border-white/25 px-4 text-sm transition-transform active:scale-[0.97]">
                    “Yes, we changed banks”
                  </button>
                </div>
              </motion.div>
            ) : stage === "ended" ? (
              <motion.div key="end" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm">
                  {outcome === "fraud" ? (
                    <>
                      Fraud confirmed. <span className="num">{usd(invoice.amount)}</span> blocked.
                    </>
                  ) : (
                    <>Change verified. Payment released.</>
                  )}
                </p>
                <button onClick={onClose} className="h-10 rounded-full bg-[#f2f0e9] px-5 text-sm font-medium text-[#121210]">
                  Done
                </button>
              </motion.div>
            ) : (
              <motion.div key="hang" exit={{ opacity: 0 }} className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-white/45">
                  {voice === "elevenlabs" ? "Voice: ElevenLabs" : voice === "browser" ? "Voice: browser fallback (no ElevenLabs key set)" : voice === "silent" ? "No voice available in this browser" : "Simulated call, no phone line is dialled"}
                </p>
                <button onClick={onClose} aria-label="Hang up" className="grid size-11 shrink-0 place-items-center rounded-full bg-[#d03b3b] text-white transition-transform active:scale-95">
                  <PhoneOff size={17} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
  );
}
