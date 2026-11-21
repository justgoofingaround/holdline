"use client";
import { animate } from "motion/react";
import { Copy, FileDiff, Landmark, Scissors, type LucideIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import type { Rule } from "@/lib/types";

export const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD" });
export const usd0 = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const fmtDate = (iso: string) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const fmtDay = (iso: string) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export const RULES: Record<Rule, { label: string; short: string; icon: LucideIcon; blurb: string }> = {
  duplicate: { label: "Duplicate invoice", short: "Duplicate", icon: Copy, blurb: "The same bill submitted twice, even with the number re-keyed." },
  split: { label: "Split invoice", short: "Split", icon: Scissors, blurb: "One bill cut into pieces to stay under the approval limit." },
  po_mismatch: { label: "PO mismatch", short: "PO mismatch", icon: FileDiff, blurb: "Billed for more than was ordered or received." },
  bank_change: { label: "Bank change", short: "Bank change", icon: Landmark, blurb: "Pay-to account changed without a callback to the vendor." },
};
export const RULE_ORDER: Rule[] = ["bank_change", "duplicate", "split", "po_mismatch"];

export const EASE = [0.16, 1, 0.3, 1] as const;
export const SPRING = { type: "spring", stiffness: 380, damping: 34, mass: 0.9 } as const;

/** A number that counts smoothly to its new value. */
export function Ticker({ value, format = usd, className }: { value: number; format?: (n: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  useEffect(() => {
    const controls = animate(shown.current, value, {
      duration: 0.7,
      ease: EASE,
      onUpdate: (v) => {
        shown.current = v;
        if (ref.current) ref.current.textContent = format(v);
      },
    });
    return () => controls.stop();
  }, [value, format]);
  return (
    <span ref={ref} className={className} suppressHydrationWarning>
      {format(value)}
    </span>
  );
}

export function RuleChip({ rule, quiet }: { rule: Rule; quiet?: boolean }) {
  const { short, icon: Icon } = RULES[rule];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium leading-none whitespace-nowrap ${
        quiet ? "border border-line text-ink2" : "bg-holdsoft text-hold"
      }`}
    >
      <Icon size={12} strokeWidth={2.2} aria-hidden />
      {short}
    </span>
  );
}
