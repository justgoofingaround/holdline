export type Line = { desc: string; qty: number; unitPrice: number };
export type Bank = { name: string; last4: string };

export type Vendor = {
  id: string;
  name: string;
  category: string;
  domain: string;
  phoneOnFile: string;
  bank: Bank;
  terms: string;
  usesPO: boolean;
  aliasOf?: string;
};

export type Invoice = {
  id: string;
  vendorId: string;
  poId: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  lines: Line[];
  amount: number;
  status: "paid" | "pending";
  paidAt: string | null;
  payToLast4: string;
  /** Free text from the vendor. Untrusted: it never changes a decision. */
  notes: string | null;
};

export type PurchaseOrder = { id: string; vendorId: string; date: string; lines: Line[]; total: number; approver: string };
export type Receipt = { id: string; poId: string; date: string; lines: { desc: string; qty: number }[] };

export type VendorChange = {
  id: string;
  vendorId: string;
  date: string;
  field: "bank_account";
  old: Bank;
  new: Bank;
  source: "email" | "portal";
  verified: "none" | "callback";
  from: string;
  subject: string;
  body: string;
};

export type Dataset = {
  meta: { seed: number; runDate: string; runId: string; approvalThreshold: number; company: string };
  vendors: Vendor[];
  purchaseOrders: PurchaseOrder[];
  receipts: Receipt[];
  invoices: Invoice[];
  vendorChanges: VendorChange[];
  runOrder: string[];
};

export type Rule = "duplicate" | "split" | "po_mismatch" | "bank_change";
export type AgentVersion = "v1" | "v2";

export type InvoiceLite = Pick<Invoice, "id" | "invoiceNumber" | "invoiceDate" | "amount" | "poId" | "status" | "paidAt" | "lines">;

export type Evidence =
  | { kind: "duplicate"; matchType: "exact_number" | "fuzzy_number" | "same_amount_window"; original: InvoiceLite }
  | { kind: "split"; siblings: InvoiceLite[]; total: number; threshold: number }
  | {
      kind: "po";
      po: PurchaseOrder;
      issues: { type: "over_total" | "unit_price" | "not_received" | "unordered_line" | "po_overbilled"; desc: string; billed: string; expected: string }[];
    }
  | { kind: "bank"; onFile: Bank; invoiceLast4: string; change: VendorChange | null };

export type Signal = { rule: Rule; title: string; detail: string; exposure: number; evidence: Evidence };

export type Span = {
  id: string;
  type: "tool" | "model" | "decision";
  name: string;
  input: unknown;
  output: unknown;
  ms: number;
  flagged: boolean;
  error?: string;
};

export type Verdict = {
  invoiceId: string;
  version: AgentVersion;
  engine: "rules" | "llm";
  decision: "hold" | "release";
  signals: Signal[];
  exposure: number;
  rationale: string;
  spans: Span[];
};

/** What the browser needs to show one row of the payment run. */
export type QueueItem = {
  invoice: Invoice;
  vendor: Vendor;
};

export type EvalReport = {
  version: AgentVersion;
  engine: "rules" | "llm";
  planted: number;
  caught: number;
  missed: number;
  falsePositives: number;
  precision: number;
  recall: number;
  exposureTotal: number;
  exposureCaught: number;
  byCategory: { rule: Rule; planted: number; caught: number }[];
  /** Payments where the model asked for a different decision than the checks allow. */
  overruled: number;
  misses: { invoiceId: string; vendor: string; invoiceNumber: string; amount: number; rule: Rule; note: string }[];
  fps: { invoiceId: string; vendor: string; invoiceNumber: string; amount: number; rule: Rule; note: string }[];
};

export type RunEvent =
  | { type: "start"; total: number; engine: "rules" | "llm"; model: string | null; version: AgentVersion }
  | { type: "verdict"; verdict: Verdict }
  | { type: "done"; ms: number };

export type KBVendorRow = {
  id: string;
  name: string;
  category: string;
  usesPO: boolean;
  invoices: number;
  pending: number;
  pos: number;
  held: number;
  bankChanges: number;
};
export type KBStats = { vendors: number; purchaseOrders: number; receipts: number; invoices: number; changes: number; unverified: number };
export type KBGraph = {
  vendor: Vendor;
  sharedBankWith: { id: string; name: string }[];
  pos: PurchaseOrder[];
  receipts: Receipt[];
  invoices: Invoice[];
  changes: VendorChange[];
  /** Agent verdicts for this vendor's invoices in the current run. */
  verdicts: Record<string, Verdict>;
};
