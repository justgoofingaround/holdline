// The agent's knowledge base: the five record tables its tools read.
import { data, getInvoice, investigate } from "./engine";
import type { AgentVersion, KBGraph, KBStats, KBVendorRow, Verdict } from "./types";

const cache: Partial<Record<AgentVersion, Map<string, Verdict>>> = {};

/** Rules-engine verdicts for every payment in the run, computed once per version. */
export function runVerdicts(version: AgentVersion) {
  let m = cache[version];
  if (!m) {
    m = new Map();
    for (const id of data.runOrder) m.set(id, investigate(getInvoice(id)!, version));
    cache[version] = m;
  }
  return m;
}

export function kbStats(): KBStats {
  return {
    vendors: data.vendors.length,
    purchaseOrders: data.purchaseOrders.length,
    receipts: data.receipts.length,
    invoices: data.invoices.length,
    changes: data.vendorChanges.length,
    unverified: data.vendorChanges.filter((c) => c.verified === "none").length,
  };
}

export function overview(version: AgentVersion): KBVendorRow[] {
  const v = runVerdicts(version);
  return data.vendors
    .map((vd) => {
      const invs = data.invoices.filter((i) => i.vendorId === vd.id);
      const pending = invs.filter((i) => i.status === "pending");
      return {
        id: vd.id,
        name: vd.name,
        category: vd.category,
        usesPO: vd.usesPO,
        invoices: invs.length,
        pending: pending.length,
        pos: data.purchaseOrders.filter((p) => p.vendorId === vd.id).length,
        held: pending.filter((i) => v.get(i.id)?.decision === "hold").length,
        bankChanges: data.vendorChanges.filter((c) => c.vendorId === vd.id).length,
      };
    })
    .sort((a, b) => b.held - a.held || a.name.localeCompare(b.name));
}

export function subgraph(vendorId: string, version: AgentVersion): KBGraph | null {
  const vendor = data.vendors.find((v) => v.id === vendorId);
  if (!vendor) return null;
  const pos = data.purchaseOrders.filter((p) => p.vendorId === vendorId);
  const poIds = new Set(pos.map((p) => p.id));
  const invoices = data.invoices.filter((i) => i.vendorId === vendorId);
  const vmap = runVerdicts(version);
  return {
    vendor,
    sharedBankWith: data.vendors
      .filter((o) => o.id !== vendorId && o.bank.name === vendor.bank.name && o.bank.last4 === vendor.bank.last4)
      .map((o) => ({ id: o.id, name: o.name })),
    pos,
    receipts: data.receipts.filter((r) => poIds.has(r.poId)),
    invoices,
    changes: data.vendorChanges.filter((c) => c.vendorId === vendorId),
    verdicts: Object.fromEntries(invoices.filter((i) => vmap.has(i.id)).map((i) => [i.id, vmap.get(i.id)!])),
  };
}
