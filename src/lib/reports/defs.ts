import type { createClient } from "@/lib/supabase/server";
import { BILL_STATUS, COST_KINDS, INVOICE_STATUS, PAY_METHODS, daysOverdue, isOpen, methodLabel, n } from "@/lib/finance";
import { DOC_KINDS, OPP_SOURCES, OPP_STAGES, TENDER_STATUSES } from "@/lib/crm";
import { loadPnl } from "@/lib/pnl";
import { namesFor } from "@/lib/people";
import { PO_STATUS } from "@/lib/purchasing";
import type { Permission } from "@/lib/roles";
import { QUOTE_STATUS, quoteNo } from "@/lib/sales";
import { DELIVERY_STATUS } from "@/lib/stock";
import { dayStart, localDay, nextDayStart, type PresetKey } from "@/lib/reports/dates";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Reports: every report the Reports section offers, what it shows and how its rows are loaded.
 * Rows are read with the person's own sign-in, so the database rules (RLS) decide what they may see;
 * `perm` and `feature` only decide which reports are offered.
 *
 * Column types: text (as is), label (English text translated on screen), date (YYYY-MM-DD),
 * datetime (ISO timestamp), money (2 decimals), qty (up to 3 decimals), int, percent.
 * Columns marked `total` are added up in the totals row. `off` columns start hidden.
 * Fields starting with "_" are not columns: they hold the ids and codes the filters use.
 */

export type ColType = "text" | "label" | "date" | "datetime" | "money" | "qty" | "int" | "percent";
export type Col = { key: string; label: string; type: ColType; total?: boolean; off?: boolean };
export type Cell = string | number | null;
export type Row = Record<string, Cell>;
export type FilterKey = "client" | "supplier" | "warehouse" | "status" | "method" | "kind" | "category";

export type LoadCtx = {
  supabase: Supabase;
  companyId: string;
  base: string;
  from: string | null;
  to: string | null;
  today: string;
  /** The filters chosen (a loader may apply some itself; the rest are applied to its rows). */
  filters: Partial<Record<FilterKey, string>>;
  /** The Stage 13 database update has been run (expenses, mobile-money services, checked payments). */
  stage13: boolean;
};

export type GroupKey = "sales" | "purchasing" | "stock" | "finance" | "lists";
export const GROUPS: { key: GroupKey; label: string; icon: "sales" | "purchasing" | "stock" | "finance" | "clients" }[] = [
  { key: "sales", label: "Sales", icon: "sales" },
  { key: "purchasing", label: "Purchasing", icon: "purchasing" },
  { key: "stock", label: "Stock & delivery", icon: "stock" },
  { key: "finance", label: "Finance", icon: "finance" },
  { key: "lists", label: "Lists", icon: "clients" },
];

export type ReportDef = {
  key: string;
  title: string;
  group: GroupKey;
  description: string;
  perm?: Permission;
  feature?: string;
  /** What the period applies to ("Invoice date"); `asAt`: the report shows the position at the end date. */
  date: { label: string; asAt?: boolean };
  defaultPreset: PresetKey;
  filters: FilterKey[];
  /** Status choices; `defaultStatuses` are the ones included when the person has not chosen (null: all). */
  statuses?: Record<string, string>;
  defaultStatuses?: string[] | null;
  defaultLabel?: string;
  cols: Col[];
  sort: { key: string; dir: "asc" | "desc" };
  load: (c: LoadCtx) => Promise<Row[]>;
  /** Fix totals that are not plain sums (a margin is worked out from the totals). */
  finishTotals?: (t: Row) => void;
};

/** At most this many rows are read for one report. */
export const MAX_ROWS = 20000;

type Result = { data: unknown; error: { message: string } | null };

/** Reads every page of a query (1,000 rows a time), up to MAX_ROWS. */
async function paged<T>(make: (from: number, to: number) => PromiseLike<Result>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

type Ranged = { gte(column: string, value: unknown): Ranged; lte(column: string, value: unknown): Ranged; lt(column: string, value: unknown): Ranged };

/** Limits a query on a date column to the period. */
function onDate<Q>(q: Q, col: string, c: LoadCtx): Q {
  let r = q as unknown as Ranged;
  if (c.from) r = r.gte(col, c.from);
  if (c.to) r = r.lte(col, c.to);
  return r as unknown as Q;
}

/** Limits a query on a timestamp column to the period (Tanzania days). */
function onTime<Q>(q: Q, col: string, c: LoadCtx, fromToo = true): Q {
  let r = q as unknown as Ranged;
  if (c.from && fromToo) r = r.gte(col, dayStart(c.from));
  if (c.to) r = r.lt(col, nextDayStart(c.to));
  return r as unknown as Q;
}

const labels = (map: Record<string, { label: string }>): Record<string, string> => Object.fromEntries(Object.entries(map).map(([k, v]) => [k, v.label]));
const money = (v: number) => Math.round(v * 100) / 100;
const one = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? (x[0] ?? null) : (x ?? null));

type Named = { name: string } | { name: string }[] | null;

const INVOICE_STATUSES: Record<string, string> = { ...labels(INVOICE_STATUS), overdue: "Overdue" };
const LIVE_INVOICE = ["issued", "partly_paid", "paid", "overdue"];
const MOVEMENT_KINDS: Record<string, string> = { receipt: "Received", dispatch: "Dispatched", return: "Returned", adjustment: "Adjustment" };

// ---------------------------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------------------------

const quotations: ReportDef = {
  key: "quotations",
  title: "Quotations",
  group: "sales",
  description: "Every quotation in the period: client, status and value.",
  perm: "seeSales",
  feature: "quotations",
  date: { label: "Quotation date" },
  defaultPreset: "this_month",
  filters: ["client", "status"],
  statuses: labels(QUOTE_STATUS),
  defaultStatuses: null,
  cols: [
    { key: "number", label: "Number", type: "text" },
    { key: "date", label: "Date", type: "date" },
    { key: "valid_until", label: "Valid until", type: "date", off: true },
    { key: "client", label: "Client", type: "text" },
    { key: "client_ref", label: "Client reference", type: "text", off: true },
    { key: "status", label: "Status", type: "label" },
    { key: "prepared_by", label: "Prepared by", type: "text", off: true },
    { key: "currency", label: "Currency", type: "text" },
    { key: "total", label: "Total", type: "money" },
    { key: "total_base", label: "Total ({base})", type: "money", total: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    type Q = { id: string; number: string; revision: number; issue_date: string; valid_until: string | null; status: string; currency: string; exchange_rate: number; total: number; client_id: string; client_ref: string | null; created_by: string | null; client: Named };
    const rows = await paged<Q>((a, b) =>
      onDate(
        c.supabase.from("quotations").select("id, number, revision, issue_date, valid_until, status, currency, exchange_rate, total, client_id, client_ref, created_by, client:clients(name)").eq("company_id", c.companyId),
        "issue_date",
        c,
      ).order("id").range(a, b),
    );
    const names = await namesFor(c.supabase, rows.map((r) => r.created_by));
    return rows.map((q) => ({
      number: quoteNo(q),
      date: q.issue_date,
      valid_until: q.valid_until,
      client: one(q.client)?.name ?? "",
      client_ref: q.client_ref,
      status: QUOTE_STATUS[q.status]?.label ?? q.status,
      prepared_by: q.created_by ? (names.get(q.created_by) ?? "") : "",
      currency: q.currency,
      total: n(q.total),
      total_base: money(n(q.total) * n(q.exchange_rate)),
      _client: q.client_id,
      _status: q.status,
    }));
  },
};

type InvoiceRow = {
  id: string; number: string; issue_date: string | null; due_date: string | null; status: string; currency: string; exchange_rate: number;
  subtotal: number; vat_amount: number; total: number; amount_paid: number; client_id: string; client_ref: string | null; client: Named;
};
const INVOICE_COLS = "id, number, issue_date, due_date, status, currency, exchange_rate, subtotal, vat_amount, total, amount_paid, client_id, client_ref, client:clients(name)";

async function loadInvoices(c: LoadCtx) {
  return paged<InvoiceRow>((a, b) =>
    onDate(c.supabase.from("invoices").select(INVOICE_COLS).eq("company_id", c.companyId).neq("status", "draft"), "issue_date", c).order("id").range(a, b),
  );
}

const invoices: ReportDef = {
  key: "invoices",
  title: "Sales invoices",
  group: "sales",
  description: "Invoices issued in the period, with what has been paid and what is still owed.",
  perm: "seeInvoices",
  feature: "invoices",
  date: { label: "Invoice date" },
  defaultPreset: "this_month",
  filters: ["client", "status"],
  statuses: Object.fromEntries(Object.entries(INVOICE_STATUSES).filter(([k]) => k !== "draft")),
  defaultStatuses: LIVE_INVOICE,
  defaultLabel: "All except cancelled",
  cols: [
    { key: "number", label: "Number", type: "text" },
    { key: "date", label: "Date", type: "date" },
    { key: "due_date", label: "Due date", type: "date" },
    { key: "client", label: "Client", type: "text" },
    { key: "client_ref", label: "Client reference", type: "text", off: true },
    { key: "status", label: "Status", type: "label" },
    { key: "currency", label: "Currency", type: "text", off: true },
    { key: "subtotal", label: "Before VAT", type: "money", off: true },
    { key: "vat", label: "VAT", type: "money", off: true },
    { key: "total", label: "Total", type: "money", off: true },
    { key: "paid", label: "Paid", type: "money", off: true },
    { key: "total_base", label: "Total ({base})", type: "money", total: true },
    { key: "paid_base", label: "Paid ({base})", type: "money", total: true },
    { key: "balance_base", label: "Balance ({base})", type: "money", total: true },
    { key: "days_overdue", label: "Days overdue", type: "int", off: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    const rows = await loadInvoices(c);
    return rows.map((i) => {
      const open = isOpen(i.status);
      const late = open ? Math.max(0, daysOverdue(i.due_date, c.today)) : 0;
      const status = open && late > 0 ? "overdue" : i.status;
      const rate = n(i.exchange_rate);
      return {
        number: i.number,
        date: i.issue_date,
        due_date: i.due_date,
        client: one(i.client)?.name ?? "",
        client_ref: i.client_ref,
        status: INVOICE_STATUSES[status] ?? status,
        currency: i.currency,
        subtotal: n(i.subtotal),
        vat: n(i.vat_amount),
        total: n(i.total),
        paid: n(i.amount_paid),
        total_base: money(n(i.total) * rate),
        paid_base: money(n(i.amount_paid) * rate),
        balance_base: i.status === "cancelled" ? 0 : money((n(i.total) - n(i.amount_paid)) * rate),
        days_overdue: late || null,
        _client: i.client_id,
        _status: status,
      };
    });
  },
};

const salesByClient: ReportDef = {
  key: "sales-by-client",
  title: "Sales by client",
  group: "sales",
  description: "How much each client bought in the period, what they paid and what they still owe.",
  perm: "seeInvoices",
  feature: "invoices",
  date: { label: "Invoice date" },
  defaultPreset: "this_year",
  filters: ["client"],
  cols: [
    { key: "client", label: "Client", type: "text" },
    { key: "invoices", label: "Invoices", type: "int", total: true },
    { key: "sales_base", label: "Sales before VAT ({base})", type: "money", total: true },
    { key: "vat_base", label: "VAT ({base})", type: "money", total: true, off: true },
    { key: "total_base", label: "Total ({base})", type: "money", total: true },
    { key: "paid_base", label: "Paid ({base})", type: "money", total: true },
    { key: "balance_base", label: "Balance ({base})", type: "money", total: true },
    { key: "share", label: "Share of sales", type: "percent" },
  ],
  sort: { key: "sales_base", dir: "desc" },
  async load(c) {
    const rows = (await loadInvoices(c)).filter((i) => i.status !== "cancelled");
    const by = new Map<string, Row>();
    let all = 0;
    for (const i of rows) {
      const rate = n(i.exchange_rate);
      const g = by.get(i.client_id) ?? { client: one(i.client)?.name ?? "", invoices: 0, sales_base: 0, vat_base: 0, total_base: 0, paid_base: 0, balance_base: 0, share: 0, _client: i.client_id };
      g.invoices = n(g.invoices) + 1;
      g.sales_base = money(n(g.sales_base) + n(i.subtotal) * rate);
      g.vat_base = money(n(g.vat_base) + n(i.vat_amount) * rate);
      g.total_base = money(n(g.total_base) + n(i.total) * rate);
      g.paid_base = money(n(g.paid_base) + n(i.amount_paid) * rate);
      g.balance_base = money(n(g.balance_base) + (n(i.total) - n(i.amount_paid)) * rate);
      all += n(i.subtotal) * rate;
      by.set(i.client_id, g);
    }
    for (const g of by.values()) g.share = all > 0 ? (n(g.sales_base) / all) * 100 : null;
    return [...by.values()];
  },
  finishTotals(t) {
    t.share = n(t.sales_base) > 0 ? 100 : null;
  },
};

const salesByProduct: ReportDef = {
  key: "sales-by-product",
  title: "Sales by product",
  group: "sales",
  description: "Quantities and value sold of each product in the period (issued invoices).",
  perm: "seeInvoices",
  feature: "invoices",
  date: { label: "Invoice date" },
  defaultPreset: "this_year",
  filters: ["client", "category"],
  cols: [
    { key: "sku", label: "SKU", type: "text" },
    { key: "product", label: "Product", type: "text" },
    { key: "category", label: "Category", type: "text", off: true },
    { key: "quantity", label: "Quantity sold", type: "qty", total: true },
    { key: "unit", label: "Unit", type: "text" },
    { key: "invoices", label: "Invoices", type: "int" },
    { key: "avg_price_base", label: "Average price ({base})", type: "money", off: true },
    { key: "sales_base", label: "Sales before VAT ({base})", type: "money", total: true },
  ],
  sort: { key: "sales_base", dir: "desc" },
  async load(c) {
    type L = {
      product_id: string | null; description: string; quantity: number; unit: string; line_total: number; invoice_id: string;
      invoice: { status: string; exchange_rate: number; client_id: string; issue_date: string } | { status: string; exchange_rate: number; client_id: string; issue_date: string }[] | null;
      product: { sku: string; name: string; category: string | null } | { sku: string; name: string; category: string | null }[] | null;
    };
    const rows = await paged<L>((a, b) =>
      onDate(
        c.supabase
          .from("invoice_lines")
          .select("product_id, description, quantity, unit, line_total, invoice_id, invoice:invoices!inner(status, exchange_rate, client_id, issue_date), product:products(sku, name, category)")
          .eq("company_id", c.companyId)
          .in("invoice.status", ["issued", "partly_paid", "paid"])
          .eq(c.filters.client ? "invoice.client_id" : "company_id", c.filters.client ?? c.companyId),
        "invoice.issue_date",
        c,
      ).order("id").range(a, b),
    );
    // One row per product and unit (the client filter is applied in the query above).
    const by = new Map<string, Row>();
    const invs = new Map<string, Set<string>>();
    for (const l of rows) {
      const inv = one(l.invoice);
      if (!inv) continue;
      const p = one(l.product);
      const k = `${l.product_id ?? `text:${l.description.trim().toLowerCase()}`}|${l.unit}`;
      const g = by.get(k) ?? { sku: p?.sku ?? "", product: p?.name ?? l.description, category: p?.category ?? "", quantity: 0, unit: l.unit, invoices: 0, avg_price_base: null, sales_base: 0, _category: p?.category ?? "" };
      g.quantity = n(g.quantity) + n(l.quantity);
      g.sales_base = money(n(g.sales_base) + n(l.line_total) * n(inv.exchange_rate));
      invs.set(k, (invs.get(k) ?? new Set<string>()).add(l.invoice_id));
      by.set(k, g);
    }
    return [...by.entries()].map(([k, g]) => ({ ...g, invoices: invs.get(k)?.size ?? 0, avg_price_base: n(g.quantity) > 0 ? money(n(g.sales_base) / n(g.quantity)) : null }));
  },
};

// ---------------------------------------------------------------------------------------------
// Purchasing
// ---------------------------------------------------------------------------------------------

type PoRow = { id: string; number: string; order_date: string; expected_date: string | null; status: string; currency: string; exchange_rate: number; total: number; supplier_id: string; supplier_ref: string | null; supplier: Named };

async function loadPos(c: LoadCtx) {
  return paged<PoRow>((a, b) =>
    onDate(
      c.supabase.from("purchase_orders").select("id, number, order_date, expected_date, status, currency, exchange_rate, total, supplier_id, supplier_ref, supplier:suppliers(name)").eq("company_id", c.companyId),
      "order_date",
      c,
    ).order("id").range(a, b),
  );
}

const purchaseOrders: ReportDef = {
  key: "purchase-orders",
  title: "Purchase orders",
  group: "purchasing",
  description: "Orders placed with suppliers in the period, their status and value.",
  perm: "seePurchasing",
  feature: "purchases",
  date: { label: "Order date" },
  defaultPreset: "this_month",
  filters: ["supplier", "status"],
  statuses: labels(PO_STATUS),
  defaultStatuses: ["pending_approval", "approved", "sent", "confirmed", "partially_received", "received", "closed"],
  defaultLabel: "All except drafts and cancelled",
  cols: [
    { key: "number", label: "Number", type: "text" },
    { key: "date", label: "Order date", type: "date" },
    { key: "expected", label: "Expected", type: "date", off: true },
    { key: "supplier", label: "Supplier", type: "text" },
    { key: "supplier_ref", label: "Supplier reference", type: "text", off: true },
    { key: "status", label: "Status", type: "label" },
    { key: "currency", label: "Currency", type: "text" },
    { key: "total", label: "Total", type: "money" },
    { key: "total_base", label: "Total ({base})", type: "money", total: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    return (await loadPos(c)).map((p) => ({
      number: p.number,
      date: p.order_date,
      expected: p.expected_date,
      supplier: one(p.supplier)?.name ?? "",
      supplier_ref: p.supplier_ref,
      status: PO_STATUS[p.status]?.label ?? p.status,
      currency: p.currency,
      total: n(p.total),
      total_base: money(n(p.total) * n(p.exchange_rate)),
      _supplier: p.supplier_id,
      _status: p.status,
    }));
  },
};

const purchasesBySupplier: ReportDef = {
  key: "purchases-by-supplier",
  title: "Purchases by supplier",
  group: "purchasing",
  description: "How much was ordered from each supplier in the period (drafts and cancelled orders left out).",
  perm: "seePurchasing",
  feature: "purchases",
  date: { label: "Order date" },
  defaultPreset: "this_year",
  filters: ["supplier"],
  cols: [
    { key: "supplier", label: "Supplier", type: "text" },
    { key: "orders", label: "Orders", type: "int", total: true },
    { key: "total_base", label: "Total ({base})", type: "money", total: true },
    { key: "share", label: "Share of purchases", type: "percent" },
  ],
  sort: { key: "total_base", dir: "desc" },
  async load(c) {
    const rows = (await loadPos(c)).filter((p) => p.status !== "draft" && p.status !== "cancelled");
    const by = new Map<string, Row>();
    let all = 0;
    for (const p of rows) {
      const v = n(p.total) * n(p.exchange_rate);
      const g = by.get(p.supplier_id) ?? { supplier: one(p.supplier)?.name ?? "", orders: 0, total_base: 0, share: 0, _supplier: p.supplier_id };
      g.orders = n(g.orders) + 1;
      g.total_base = money(n(g.total_base) + v);
      all += v;
      by.set(p.supplier_id, g);
    }
    for (const g of by.values()) g.share = all > 0 ? (n(g.total_base) / all) * 100 : null;
    return [...by.values()];
  },
  finishTotals(t) {
    t.share = n(t.total_base) > 0 ? 100 : null;
  },
};

const goodsReceived: ReportDef = {
  key: "goods-received",
  title: "Goods received",
  group: "purchasing",
  description: "Goods received notes (GRNs) in the period: what came in, from whom and into which store.",
  perm: "seePurchasing",
  feature: "goods_received",
  date: { label: "Date received" },
  defaultPreset: "this_month",
  filters: ["supplier", "warehouse"],
  cols: [
    { key: "number", label: "GRN number", type: "text" },
    { key: "date", label: "Date received", type: "date" },
    { key: "po", label: "Purchase order", type: "text" },
    { key: "supplier", label: "Supplier", type: "text" },
    { key: "store", label: "Store", type: "text" },
    { key: "delivery_note", label: "Supplier delivery note", type: "text" },
    { key: "received_by", label: "Received by", type: "text", off: true },
    { key: "notes", label: "Notes", type: "text", off: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    type G = {
      number: string; received_on: string; supplier_delivery_note: string | null; notes: string | null; received_by: string | null; warehouse_id: string;
      warehouse: Named; po: { number: string; supplier_id: string; supplier: Named } | { number: string; supplier_id: string; supplier: Named }[] | null;
    };
    const rows = await paged<G>((a, b) =>
      onDate(
        c.supabase
          .from("goods_receipts")
          .select("number, received_on, supplier_delivery_note, notes, received_by, warehouse_id, warehouse:warehouses(name), po:purchase_orders(number, supplier_id, supplier:suppliers(name))")
          .eq("company_id", c.companyId),
        "received_on",
        c,
      ).order("id").range(a, b),
    );
    const names = await namesFor(c.supabase, rows.map((r) => r.received_by));
    return rows.map((g) => {
      const po = one(g.po);
      return {
        number: g.number,
        date: g.received_on,
        po: po?.number ?? "",
        supplier: one(po?.supplier)?.name ?? "",
        store: one(g.warehouse)?.name ?? "",
        delivery_note: g.supplier_delivery_note,
        received_by: g.received_by ? (names.get(g.received_by) ?? "") : "",
        notes: g.notes,
        _supplier: po?.supplier_id ?? null,
        _warehouse: g.warehouse_id,
      };
    });
  },
};

// ---------------------------------------------------------------------------------------------
// Stock & delivery
// ---------------------------------------------------------------------------------------------

const STOCK_STATUS: Record<string, string> = { low: "Reorder now", ok: "Enough stock", none: "No reorder level" };

type Product = { sku: string; name: string; category: string | null; unit: string; reorder_level: number | null };

const stockOnHand: ReportDef = {
  key: "stock-on-hand",
  title: "Stock on hand",
  group: "stock",
  description: "How much of each product was in each store at the end of the chosen day, with low-stock warnings.",
  perm: "seeStock",
  feature: "inventory",
  date: { label: "Stock at the end of", asAt: true },
  defaultPreset: "today",
  filters: ["warehouse", "category", "status"],
  statuses: STOCK_STATUS,
  defaultStatuses: null,
  cols: [
    { key: "sku", label: "SKU", type: "text" },
    { key: "product", label: "Product", type: "text" },
    { key: "category", label: "Category", type: "text", off: true },
    { key: "store", label: "Store", type: "text" },
    { key: "quantity", label: "Quantity", type: "qty", total: true },
    { key: "unit", label: "Unit", type: "text" },
    { key: "reorder_level", label: "Reorder level", type: "qty" },
    { key: "status", label: "Status", type: "label" },
  ],
  sort: { key: "product", dir: "asc" },
  async load(c) {
    type M = { product_id: string; warehouse_id: string; quantity: number; product: Product | Product[] | null; warehouse: Named };
    const rows = await paged<M>((a, b) =>
      onTime(
        c.supabase
          .from("stock_movements")
          .select("product_id, warehouse_id, quantity, product:products(sku, name, category, unit, reorder_level), warehouse:warehouses(name)")
          .eq("company_id", c.companyId),
        "created_at",
        c,
        false,
      ).order("id").range(a, b),
    );
    const by = new Map<string, Row>();
    for (const m of rows) {
      const k = `${m.product_id}|${m.warehouse_id}`;
      const p = one(m.product);
      const g = by.get(k) ?? { sku: p?.sku ?? "", product: p?.name ?? "", category: p?.category ?? "", store: one(m.warehouse)?.name ?? "", quantity: 0, unit: p?.unit ?? "", reorder_level: p?.reorder_level ?? null, status: "", _warehouse: m.warehouse_id, _category: p?.category ?? "" };
      g.quantity = Math.round((n(g.quantity) + n(m.quantity)) * 1000) / 1000;
      by.set(k, g);
    }
    return [...by.values()]
      .filter((g) => n(g.quantity) !== 0)
      .map((g) => {
        const s = g.reorder_level === null ? "none" : n(g.quantity) <= n(g.reorder_level) ? "low" : "ok";
        return { ...g, status: STOCK_STATUS[s], _status: s };
      });
  },
};

const stockMovements: ReportDef = {
  key: "stock-movements",
  title: "Stock movements",
  group: "stock",
  description: "Every receipt, dispatch, return and adjustment of stock in the period.",
  perm: "seeStock",
  feature: "inventory",
  date: { label: "Date" },
  defaultPreset: "this_month",
  filters: ["warehouse", "category", "kind"],
  cols: [
    { key: "when", label: "Date and time", type: "datetime" },
    { key: "sku", label: "SKU", type: "text" },
    { key: "product", label: "Product", type: "text" },
    { key: "store", label: "Store", type: "text" },
    { key: "kind", label: "Movement", type: "label" },
    { key: "quantity", label: "Quantity (+ in, − out)", type: "qty", total: true },
    { key: "unit", label: "Unit", type: "text" },
    { key: "batch", label: "Batch", type: "text", off: true },
    { key: "expiry", label: "Expiry", type: "date", off: true },
    { key: "note", label: "Note", type: "text", off: true },
    { key: "by", label: "Recorded by", type: "text", off: true },
  ],
  sort: { key: "when", dir: "desc" },
  async load(c) {
    type M = { created_at: string; quantity: number; kind: string; batch_no: string; expiry_date: string | null; note: string | null; created_by: string | null; warehouse_id: string; product: Product | Product[] | null; warehouse: Named };
    const rows = await paged<M>((a, b) =>
      onTime(
        c.supabase
          .from("stock_movements")
          .select("created_at, quantity, kind, batch_no, expiry_date, note, created_by, warehouse_id, product:products(sku, name, category, unit, reorder_level), warehouse:warehouses(name)")
          .eq("company_id", c.companyId),
        "created_at",
        c,
      ).order("id").range(a, b),
    );
    const names = await namesFor(c.supabase, rows.map((r) => r.created_by));
    return rows.map((m) => {
      const p = one(m.product);
      return {
        when: m.created_at,
        sku: p?.sku ?? "",
        product: p?.name ?? "",
        store: one(m.warehouse)?.name ?? "",
        kind: MOVEMENT_KINDS[m.kind] ?? m.kind,
        quantity: n(m.quantity),
        unit: p?.unit ?? "",
        batch: m.batch_no,
        expiry: m.expiry_date,
        note: m.note,
        by: m.created_by ? (names.get(m.created_by) ?? "") : "",
        _warehouse: m.warehouse_id,
        _category: p?.category ?? "",
        _kind: m.kind,
      };
    });
  },
};

const deliveries: ReportDef = {
  key: "deliveries",
  title: "Deliveries",
  group: "stock",
  description: "Delivery notes in the period: client, store, driver and whether the goods arrived.",
  perm: "seeDeliveries",
  feature: "deliveries",
  date: { label: "Delivery date (planned, or actual once delivered)" },
  defaultPreset: "this_month",
  filters: ["client", "warehouse", "status"],
  statuses: labels(DELIVERY_STATUS),
  defaultStatuses: null,
  cols: [
    { key: "number", label: "Number", type: "text" },
    { key: "date", label: "Date", type: "date" },
    { key: "client", label: "Client", type: "text" },
    { key: "site", label: "Delivery site", type: "text", off: true },
    { key: "store", label: "Store", type: "text" },
    { key: "status", label: "Status", type: "label" },
    { key: "driver", label: "Driver", type: "text" },
    { key: "vehicle", label: "Vehicle", type: "text", off: true },
    { key: "received_by", label: "Received by", type: "text" },
    { key: "failed_reason", label: "Reason not delivered", type: "text", off: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    type D = {
      number: string; planned_date: string | null; delivered_at: string | null; created_at: string; status: string; delivery_site: string | null; vehicle: string | null;
      received_by_name: string | null; failed_reason: string | null; driver_id: string | null; client_id: string; warehouse_id: string; client: Named; warehouse: Named;
    };
    // The date is worked out per delivery (actual, planned or created), so the period is applied here.
    const rows = await paged<D>((a, b) =>
      c.supabase
        .from("deliveries")
        .select("number, planned_date, delivered_at, created_at, status, delivery_site, vehicle, received_by_name, failed_reason, driver_id, client_id, warehouse_id, client:clients(name), warehouse:warehouses(name)")
        .eq("company_id", c.companyId)
        .order("id")
        .range(a, b),
    );
    const names = await namesFor(c.supabase, rows.map((r) => r.driver_id));
    return rows
      .map((d) => ({ d, date: localDay(d.delivered_at) ?? d.planned_date ?? localDay(d.created_at) }))
      .filter(({ date }) => date && (!c.from || date >= c.from) && (!c.to || date <= c.to))
      .map(({ d, date }) => ({
        number: d.number,
        date,
        client: one(d.client)?.name ?? "",
        site: d.delivery_site,
        store: one(d.warehouse)?.name ?? "",
        status: DELIVERY_STATUS[d.status]?.label ?? d.status,
        driver: d.driver_id ? (names.get(d.driver_id) ?? "") : "",
        vehicle: d.vehicle,
        received_by: d.received_by_name,
        failed_reason: d.failed_reason,
        _client: d.client_id,
        _warehouse: d.warehouse_id,
        _status: d.status,
      }));
  },
};

// ---------------------------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------------------------

const paymentsReceived: ReportDef = {
  key: "payments-received",
  title: "Payments received",
  group: "finance",
  description: "Money received from clients in the period, by method.",
  perm: "seeFinance",
  feature: "payments",
  date: { label: "Date received" },
  defaultPreset: "this_month",
  filters: ["client", "method", "status"],
  statuses: { valid: "Valid", voided: "Voided" },
  defaultStatuses: ["valid"],
  defaultLabel: "Valid only",
  cols: [
    { key: "number", label: "Receipt number", type: "text" },
    { key: "date", label: "Date", type: "date" },
    { key: "client", label: "Client", type: "text" },
    { key: "invoice", label: "Invoice", type: "text" },
    { key: "method", label: "Method", type: "label" },
    { key: "reference", label: "Reference", type: "text" },
    { key: "checked", label: "Checked against statement", type: "label", off: true },
    { key: "currency", label: "Currency", type: "text", off: true },
    { key: "amount", label: "Amount", type: "money", off: true },
    { key: "amount_base", label: "Amount ({base})", type: "money", total: true },
    { key: "status", label: "Status", type: "label", off: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    type P = { number: string; received_on: string; amount: number; currency: string; exchange_rate: number; method: string; provider?: string | null; reconciled_at?: string | null; reference: string | null; voided_at: string | null; client_id: string; client: Named; invoice: { number: string } | { number: string }[] | null };
    const rows = await paged<P>((a, b) =>
      onDate(
        c.supabase.from("payments").select(`number, received_on, amount, currency, exchange_rate, method, reference, voided_at, client_id, client:clients(name), invoice:invoices(number)${c.stage13 ? ", provider, reconciled_at" : ""}`).eq("company_id", c.companyId),
        "received_on",
        c,
      ).order("id").range(a, b),
    );
    return rows.map((p) => ({
      number: p.number,
      date: p.received_on,
      client: one(p.client)?.name ?? "",
      invoice: one(p.invoice)?.number ?? "",
      method: methodLabel(p.method, p.provider),
      reference: p.reference,
      checked: p.reconciled_at ? "Yes" : "No",
      currency: p.currency,
      amount: n(p.amount),
      amount_base: money(n(p.amount) * n(p.exchange_rate)),
      status: p.voided_at ? "Voided" : "Valid",
      _client: p.client_id,
      _method: p.method,
      _status: p.voided_at ? "voided" : "valid",
    }));
  },
};

const BILL_STATUSES: Record<string, string> = { ...labels(BILL_STATUS), overdue: "Overdue" };

const supplierBills: ReportDef = {
  key: "supplier-bills",
  title: "Supplier bills",
  group: "finance",
  description: "Suppliers' invoices in the period, what has been paid and what we still owe.",
  perm: "seeBills",
  feature: "supplier_bills",
  date: { label: "Bill date" },
  defaultPreset: "this_month",
  filters: ["supplier", "status"],
  statuses: BILL_STATUSES,
  defaultStatuses: ["open", "partly_paid", "paid", "overdue"],
  defaultLabel: "All except cancelled",
  cols: [
    { key: "number", label: "Number", type: "text" },
    { key: "supplier_invoice", label: "Supplier's invoice no.", type: "text" },
    { key: "date", label: "Bill date", type: "date" },
    { key: "due_date", label: "Due date", type: "date" },
    { key: "supplier", label: "Supplier", type: "text" },
    { key: "status", label: "Status", type: "label" },
    { key: "currency", label: "Currency", type: "text", off: true },
    { key: "total", label: "Total", type: "money", off: true },
    { key: "total_base", label: "Total ({base})", type: "money", total: true },
    { key: "paid_base", label: "Paid ({base})", type: "money", total: true },
    { key: "balance_base", label: "Balance ({base})", type: "money", total: true },
    { key: "days_overdue", label: "Days overdue", type: "int", off: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    type B = { number: string; supplier_invoice_no: string | null; bill_date: string; due_date: string | null; status: string; currency: string; exchange_rate: number; total: number; amount_paid: number; supplier_id: string; supplier: Named };
    const rows = await paged<B>((a, b) =>
      onDate(
        c.supabase.from("supplier_bills").select("number, supplier_invoice_no, bill_date, due_date, status, currency, exchange_rate, total, amount_paid, supplier_id, supplier:suppliers(name)").eq("company_id", c.companyId),
        "bill_date",
        c,
      ).order("id").range(a, b),
    );
    return rows.map((b) => {
      const open = isOpen(b.status);
      const late = open ? Math.max(0, daysOverdue(b.due_date, c.today)) : 0;
      const status = open && late > 0 ? "overdue" : b.status;
      const rate = n(b.exchange_rate);
      return {
        number: b.number,
        supplier_invoice: b.supplier_invoice_no,
        date: b.bill_date,
        due_date: b.due_date,
        supplier: one(b.supplier)?.name ?? "",
        status: BILL_STATUSES[status] ?? status,
        currency: b.currency,
        total: n(b.total),
        total_base: money(n(b.total) * rate),
        paid_base: money(n(b.amount_paid) * rate),
        balance_base: b.status === "cancelled" ? 0 : money((n(b.total) - n(b.amount_paid)) * rate),
        days_overdue: late || null,
        _supplier: b.supplier_id,
        _status: status,
      };
    });
  },
};

const supplierPayments: ReportDef = {
  key: "supplier-payments",
  title: "Payments to suppliers",
  group: "finance",
  description: "Money paid to suppliers in the period, by method.",
  perm: "seeBills",
  feature: "supplier_bills",
  date: { label: "Date paid" },
  defaultPreset: "this_month",
  filters: ["supplier", "method", "status"],
  statuses: { valid: "Valid", voided: "Voided" },
  defaultStatuses: ["valid"],
  defaultLabel: "Valid only",
  cols: [
    { key: "number", label: "Payment number", type: "text" },
    { key: "date", label: "Date", type: "date" },
    { key: "supplier", label: "Supplier", type: "text" },
    { key: "bill", label: "Bill", type: "text" },
    { key: "method", label: "Method", type: "label" },
    { key: "reference", label: "Reference", type: "text" },
    { key: "checked", label: "Checked against statement", type: "label", off: true },
    { key: "currency", label: "Currency", type: "text", off: true },
    { key: "amount", label: "Amount", type: "money", off: true },
    { key: "amount_base", label: "Amount ({base})", type: "money", total: true },
    { key: "status", label: "Status", type: "label", off: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    type P = { number: string; paid_on: string; amount: number; currency: string; exchange_rate: number; method: string; provider?: string | null; reconciled_at?: string | null; reference: string | null; voided_at: string | null; supplier_id: string; supplier: Named; bill: { number: string } | { number: string }[] | null };
    const rows = await paged<P>((a, b) =>
      onDate(
        c.supabase.from("supplier_payments").select(`number, paid_on, amount, currency, exchange_rate, method, reference, voided_at, supplier_id, supplier:suppliers(name), bill:supplier_bills(number)${c.stage13 ? ", provider, reconciled_at" : ""}`).eq("company_id", c.companyId),
        "paid_on",
        c,
      ).order("id").range(a, b),
    );
    return rows.map((p) => ({
      number: p.number,
      date: p.paid_on,
      supplier: one(p.supplier)?.name ?? "",
      bill: one(p.bill)?.number ?? "",
      method: methodLabel(p.method, p.provider),
      reference: p.reference,
      checked: p.reconciled_at ? "Yes" : "No",
      currency: p.currency,
      amount: n(p.amount),
      amount_base: money(n(p.amount) * n(p.exchange_rate)),
      status: p.voided_at ? "Voided" : "Valid",
      _supplier: p.supplier_id,
      _method: p.method,
      _status: p.voided_at ? "voided" : "valid",
    }));
  },
};

const profit: ReportDef = {
  key: "profit-by-invoice",
  title: "Profit by invoice",
  group: "finance",
  description: "Sales, cost of goods and gross profit of each issued invoice in the period.",
  perm: "seeProfit",
  feature: "profit_analysis",
  date: { label: "Invoice date" },
  defaultPreset: "this_month",
  filters: ["client"],
  cols: [
    { key: "number", label: "Invoice", type: "text" },
    { key: "date", label: "Date", type: "date" },
    { key: "client", label: "Client", type: "text" },
    { key: "sales_base", label: "Sales before VAT ({base})", type: "money", total: true },
    { key: "cost_base", label: "Cost of goods ({base})", type: "money", total: true },
    { key: "profit_base", label: "Gross profit ({base})", type: "money", total: true },
    { key: "margin", label: "Margin", type: "percent" },
    { key: "missing", label: "Items without cost", type: "int", off: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    type P = { invoice_id: string; client_id: string; issue_date: string; revenue_base: number; cost_base: number; lines_without_cost: number };
    const rows = await paged<P>((a, b) =>
      onDate(
        c.supabase.from("invoice_profit").select("invoice_id, client_id, issue_date, revenue_base, cost_base, lines_without_cost").eq("company_id", c.companyId),
        "issue_date",
        c,
      ).order("invoice_id").range(a, b),
    );
    const [inv, cl] = await Promise.all([
      paged<{ id: string; number: string }>((a, b) => onDate(c.supabase.from("invoices").select("id, number").eq("company_id", c.companyId).neq("status", "draft"), "issue_date", c).order("id").range(a, b)),
      paged<{ id: string; name: string }>((a, b) => c.supabase.from("clients").select("id, name").eq("company_id", c.companyId).order("id").range(a, b)),
    ]);
    const numbers = new Map(inv.map((i) => [i.id, i.number]));
    const clients = new Map(cl.map((x) => [x.id, x.name]));
    return rows.map((p) => {
      const s = n(p.revenue_base);
      const gp = s - n(p.cost_base);
      return {
        number: numbers.get(p.invoice_id) ?? "",
        date: p.issue_date,
        client: clients.get(p.client_id) ?? "",
        sales_base: money(s),
        cost_base: money(n(p.cost_base)),
        profit_base: money(gp),
        margin: s > 0 ? (gp / s) * 100 : null,
        missing: n(p.lines_without_cost) || null,
        _client: p.client_id,
      };
    });
  },
  finishTotals(t) {
    t.margin = n(t.sales_base) > 0 ? (n(t.profit_base) / n(t.sales_base)) * 100 : null;
  },
};

const orderCosts: ReportDef = {
  key: "order-costs",
  title: "Order and import costs",
  group: "finance",
  description: "Freight, duty, clearing, transport and other costs recorded on orders in the period.",
  perm: "seeCosts",
  date: { label: "Date of cost" },
  defaultPreset: "this_month",
  filters: ["kind"],
  cols: [
    { key: "date", label: "Date", type: "date" },
    { key: "kind", label: "Type of cost", type: "label" },
    { key: "description", label: "Description", type: "text" },
    { key: "order", label: "Order", type: "text" },
    { key: "currency", label: "Currency", type: "text", off: true },
    { key: "amount", label: "Amount", type: "money", off: true },
    { key: "amount_base", label: "Amount ({base})", type: "money", total: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    type O = { incurred_on: string; kind: string; description: string | null; amount: number; currency: string; exchange_rate: number; quotation: { number: string; revision: number } | { number: string; revision: number }[] | null; po: { number: string } | { number: string }[] | null };
    const rows = await paged<O>((a, b) =>
      onDate(
        c.supabase.from("order_costs").select("incurred_on, kind, description, amount, currency, exchange_rate, quotation:quotations(number, revision), po:purchase_orders(number)").eq("company_id", c.companyId),
        "incurred_on",
        c,
      ).order("id").range(a, b),
    );
    return rows.map((o) => {
      const q = one(o.quotation);
      return {
        date: o.incurred_on,
        kind: COST_KINDS[o.kind] ?? o.kind,
        description: o.description,
        order: q ? quoteNo(q) : (one(o.po)?.number ?? ""),
        currency: o.currency,
        amount: n(o.amount),
        amount_base: money(n(o.amount) * n(o.exchange_rate)),
        _kind: o.kind,
      };
    });
  },
};


const expenseList: ReportDef = {
  key: "expenses",
  title: "Expenses",
  group: "finance",
  description: "Every expense paid in the period: rent, fuel, wages, bank charges and the rest.",
  perm: "manageExpenses",
  feature: "expenses",
  date: { label: "Date paid" },
  defaultPreset: "this_month",
  filters: ["category", "method", "status"],
  statuses: { valid: "Valid", voided: "Voided" },
  defaultStatuses: ["valid"],
  defaultLabel: "Valid only",
  cols: [
    { key: "number", label: "Number", type: "text", off: true },
    { key: "date", label: "Date", type: "date" },
    { key: "category", label: "Spending category", type: "label" },
    { key: "description", label: "Description", type: "text" },
    { key: "payee", label: "Paid to", type: "text" },
    { key: "method", label: "Method", type: "label" },
    { key: "reference", label: "Reference", type: "text", off: true },
    { key: "receipt", label: "Receipt photo", type: "label", off: true },
    { key: "checked", label: "Checked against statement", type: "label", off: true },
    { key: "recorded_by", label: "Recorded by", type: "text", off: true },
    { key: "currency", label: "Currency", type: "text", off: true },
    { key: "amount", label: "Amount", type: "money", off: true },
    { key: "vat_base", label: "VAT ({base})", type: "money", total: true, off: true },
    { key: "amount_base", label: "Amount ({base})", type: "money", total: true },
    { key: "status", label: "Status", type: "label", off: true },
  ],
  sort: { key: "date", dir: "desc" },
  async load(c) {
    if (!c.stage13) return [];
    type E = { number: string; spent_on: string; description: string; payee: string | null; amount: number; vat_amount: number; currency: string; exchange_rate: number; method: string; provider: string | null; reference: string | null; receipt_path: string | null; reconciled_at: string | null; voided_at: string | null; created_by: string | null; category_id: string; category: Named };
    const rows = await paged<E>((a, b) =>
      onDate(
        c.supabase
          .from("expenses")
          .select("number, spent_on, description, payee, amount, vat_amount, currency, exchange_rate, method, provider, reference, receipt_path, reconciled_at, voided_at, created_by, category_id, category:expense_categories(name)")
          .eq("company_id", c.companyId),
        "spent_on",
        c,
      ).order("id").range(a, b),
    );
    const names = await namesFor(c.supabase, rows.map((e) => e.created_by));
    return rows.map((e) => ({
      number: e.number,
      date: e.spent_on,
      category: one(e.category)?.name ?? "",
      description: e.description,
      payee: e.payee,
      method: methodLabel(e.method, e.provider),
      reference: e.reference,
      receipt: e.receipt_path ? "Yes" : "No",
      checked: e.reconciled_at ? "Yes" : "No",
      recorded_by: e.created_by ? (names.get(e.created_by) ?? "") : "",
      currency: e.currency,
      amount: n(e.amount),
      vat_base: money(n(e.vat_amount) * n(e.exchange_rate)),
      amount_base: money(n(e.amount) * n(e.exchange_rate)),
      status: e.voided_at ? "Voided" : "Valid",
      _category: e.category_id,
      _method: e.method,
      _status: e.voided_at ? "voided" : "valid",
    }));
  },
};

const expensesByCategory: ReportDef = {
  key: "expenses-by-category",
  title: "Expenses by category",
  group: "finance",
  description: "What the business spent in the period, added up by category.",
  perm: "manageExpenses",
  feature: "expenses",
  date: { label: "Date paid" },
  defaultPreset: "this_month",
  filters: [],
  cols: [
    { key: "category", label: "Spending category", type: "label" },
    { key: "count", label: "Expenses", type: "int", total: true },
    { key: "net_base", label: "Before VAT ({base})", type: "money", total: true },
    { key: "vat_base", label: "VAT ({base})", type: "money", total: true, off: true },
    { key: "amount_base", label: "Amount paid ({base})", type: "money", total: true },
    { key: "share", label: "Share", type: "percent" },
  ],
  sort: { key: "amount_base", dir: "desc" },
  async load(c) {
    if (!c.stage13) return [];
    type E = { amount: number; vat_amount: number; exchange_rate: number; category_id: string; category: Named };
    const rows = await paged<E>((a, b) =>
      onDate(
        c.supabase.from("expenses").select("amount, vat_amount, exchange_rate, category_id, category:expense_categories(name)").eq("company_id", c.companyId).is("voided_at", null),
        "spent_on",
        c,
      ).order("id").range(a, b),
    );
    const map = new Map<string, Row & { amount_base: number; vat_base: number; net_base: number; count: number }>();
    let total = 0;
    for (const e of rows) {
      const g = map.get(e.category_id) ?? { category: one(e.category)?.name ?? "", count: 0, net_base: 0, vat_base: 0, amount_base: 0, share: 0 };
      const amt = n(e.amount) * n(e.exchange_rate);
      const vat = n(e.vat_amount) * n(e.exchange_rate);
      g.count += 1;
      g.amount_base += amt;
      g.vat_base += vat;
      g.net_base += amt - vat;
      total += amt;
      map.set(e.category_id, g);
    }
    return [...map.values()].map((g) => ({
      ...g,
      amount_base: money(g.amount_base),
      vat_base: money(g.vat_base),
      net_base: money(g.net_base),
      share: total > 0 ? Math.round((g.amount_base / total) * 1000) / 10 : 0,
    }));
  },
  finishTotals(t) {
    t.share = 100;
  },
};

const profitLoss: ReportDef = {
  key: "profit-loss",
  title: "Profit & loss by month",
  group: "finance",
  description: "Sales, cost of sales, gross profit, order costs, expenses and net profit, month by month.",
  perm: "seeProfit",
  feature: "simple_pl",
  date: { label: "Month" },
  defaultPreset: "this_year",
  filters: [],
  cols: [
    { key: "month", label: "Month", type: "text" },
    { key: "sales", label: "Sales before VAT ({base})", type: "money", total: true },
    { key: "cogs", label: "Cost of goods sold ({base})", type: "money", total: true },
    { key: "gross", label: "Gross profit ({base})", type: "money", total: true },
    { key: "order_costs", label: "Order costs ({base})", type: "money", total: true },
    { key: "expenses", label: "Expenses before VAT ({base})", type: "money", total: true },
    { key: "net", label: "Net profit ({base})", type: "money", total: true },
    { key: "margin", label: "Net margin", type: "percent" },
  ],
  sort: { key: "month", dir: "asc" },
  async load(c) {
    const to = c.to ?? c.today;
    const start = (c.from ?? `${to.slice(0, 4)}-01-01`).slice(0, 7);
    const months: string[] = [];
    for (let m = start; m <= to.slice(0, 7) && months.length < 36; ) {
      months.push(m);
      const [y, mm] = m.split("-").map(Number);
      m = mm === 12 ? `${y + 1}-01` : `${y}-${String(mm + 1).padStart(2, "0")}`;
    }
    const nextDay = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
    return Promise.all(
      months.map(async (m, i) => {
        const [y, mm] = m.split("-").map(Number);
        const monthEnd = mm === 12 ? `${y + 1}-01-01` : `${y}-${String(mm + 1).padStart(2, "0")}-01`;
        const from = i === 0 && c.from ? c.from : `${m}-01`;
        const end = i === months.length - 1 ? nextDay(to) : monthEnd;
        const p = await loadPnl(c.supabase, c.companyId, from, end < monthEnd ? end : monthEnd, c.stage13);
        return {
          month: m,
          sales: money(p.sales),
          cogs: money(p.cogs),
          gross: money(p.gross),
          order_costs: money(p.orderCosts),
          expenses: money(p.expenses),
          net: money(p.net),
          margin: p.sales > 0 ? Math.round((p.net / p.sales) * 1000) / 10 : null,
        };
      }),
    );
  },
  finishTotals(t) {
    t.margin = n(t.sales) > 0 ? Math.round((n(t.net) / n(t.sales)) * 1000) / 10 : null;
  },
};

// ---------------------------------------------------------------------------------------------
// Lists (the period is the date the record was added; "All time" by default)
// ---------------------------------------------------------------------------------------------

const ACTIVE = { active: "Active", archived: "Archived" };

const clientList: ReportDef = {
  key: "clients",
  title: "Client list",
  group: "lists",
  description: "Your clients with their tax numbers, terms and credit limits.",
  feature: "customers",
  date: { label: "Date added" },
  defaultPreset: "all",
  filters: ["status"],
  statuses: ACTIVE,
  defaultStatuses: ["active"],
  defaultLabel: "Active only",
  cols: [
    { key: "code", label: "Code", type: "text" },
    { key: "name", label: "Name", type: "text" },
    { key: "industry", label: "Industry", type: "text" },
    { key: "region", label: "Region", type: "text", off: true },
    { key: "address", label: "Address", type: "text", off: true },
    { key: "tin", label: "TIN", type: "text" },
    { key: "vrn", label: "VRN", type: "text", off: true },
    { key: "terms", label: "Payment terms", type: "text" },
    { key: "currency", label: "Currency", type: "text", off: true },
    { key: "credit_limit", label: "Credit limit", type: "money" },
    { key: "added", label: "Date added", type: "date", off: true },
  ],
  sort: { key: "name", dir: "asc" },
  async load(c) {
    type C = { code: string; name: string; industry: string | null; region: string | null; address: string | null; tin: string | null; vrn: string | null; payment_terms: string | null; currency: string; credit_limit: number; active: boolean; created_at: string };
    const rows = await paged<C>((a, b) =>
      onTime(c.supabase.from("clients").select("code, name, industry, region, address, tin, vrn, payment_terms, currency, credit_limit, active, created_at").eq("company_id", c.companyId), "created_at", c).order("id").range(a, b),
    );
    return rows.map((x) => ({
      code: x.code, name: x.name, industry: x.industry, region: x.region, address: x.address, tin: x.tin, vrn: x.vrn, terms: x.payment_terms,
      currency: x.currency, credit_limit: n(x.credit_limit), added: localDay(x.created_at), _status: x.active ? "active" : "archived",
    }));
  },
};

const supplierList: ReportDef = {
  key: "suppliers",
  title: "Supplier list",
  group: "lists",
  description: "Your suppliers with their contacts, currency, terms and lead times.",
  perm: "seeSuppliers",
  feature: "suppliers",
  date: { label: "Date added" },
  defaultPreset: "all",
  filters: ["status"],
  statuses: ACTIVE,
  defaultStatuses: ["active"],
  defaultLabel: "Active only",
  cols: [
    { key: "code", label: "Code", type: "text" },
    { key: "name", label: "Name", type: "text" },
    { key: "country", label: "Country", type: "text" },
    { key: "city", label: "City", type: "text", off: true },
    { key: "contact", label: "Contact person", type: "text" },
    { key: "phone", label: "Phone", type: "text" },
    { key: "email", label: "Email", type: "text", off: true },
    { key: "products", label: "Products supplied", type: "text", off: true },
    { key: "currency", label: "Currency", type: "text", off: true },
    { key: "terms", label: "Payment terms", type: "text", off: true },
    { key: "lead_time", label: "Lead time (days)", type: "int", off: true },
    { key: "added", label: "Date added", type: "date", off: true },
  ],
  sort: { key: "name", dir: "asc" },
  async load(c) {
    type S = { code: string; name: string; country: string | null; city: string | null; contact_person: string | null; phone: string | null; email: string | null; products_supplied: string | null; currency: string; payment_terms: string | null; lead_time_days: number | null; active: boolean; created_at: string };
    const rows = await paged<S>((a, b) =>
      onTime(
        c.supabase.from("suppliers").select("code, name, country, city, contact_person, phone, email, products_supplied, currency, payment_terms, lead_time_days, active, created_at").eq("company_id", c.companyId),
        "created_at",
        c,
      ).order("id").range(a, b),
    );
    return rows.map((x) => ({
      code: x.code, name: x.name, country: x.country, city: x.city, contact: x.contact_person, phone: x.phone, email: x.email, products: x.products_supplied,
      currency: x.currency, terms: x.payment_terms, lead_time: x.lead_time_days, added: localDay(x.created_at), _status: x.active ? "active" : "archived",
    }));
  },
};

const productList: ReportDef = {
  key: "products",
  title: "Product list",
  group: "lists",
  description: "Your catalogue: SKU, category, brand, unit, selling price and reorder level.",
  feature: "products",
  date: { label: "Date added" },
  defaultPreset: "all",
  filters: ["category", "status"],
  statuses: ACTIVE,
  defaultStatuses: ["active"],
  defaultLabel: "Active only",
  cols: [
    { key: "sku", label: "SKU", type: "text" },
    { key: "name", label: "Name", type: "text" },
    { key: "category", label: "Category", type: "text" },
    { key: "brand", label: "Brand", type: "text" },
    { key: "part_no", label: "Part number", type: "text", off: true },
    { key: "unit", label: "Unit", type: "text" },
    { key: "price", label: "Selling price", type: "money" },
    { key: "reorder_level", label: "Reorder level", type: "qty", off: true },
    { key: "origin", label: "Country of origin", type: "text", off: true },
    { key: "added", label: "Date added", type: "date", off: true },
  ],
  sort: { key: "name", dir: "asc" },
  async load(c) {
    type P = { sku: string; name: string; category: string | null; brand: string | null; mfr_part_no: string | null; unit: string; selling_price: number | null; reorder_level: number | null; country_of_origin: string | null; active: boolean; created_at: string };
    const rows = await paged<P>((a, b) =>
      onTime(
        c.supabase.from("products").select("sku, name, category, brand, mfr_part_no, unit, selling_price, reorder_level, country_of_origin, active, created_at").eq("company_id", c.companyId),
        "created_at",
        c,
      ).order("id").range(a, b),
    );
    return rows.map((x) => ({
      sku: x.sku, name: x.name, category: x.category, brand: x.brand, part_no: x.mfr_part_no, unit: x.unit,
      price: x.selling_price === null ? null : n(x.selling_price), reorder_level: x.reorder_level, origin: x.country_of_origin,
      added: localDay(x.created_at), _category: x.category ?? "", _status: x.active ? "active" : "archived",
    }));
  },
};

// ---- Stage 14: pipeline, tenders, documents ---------------------------------------------------
/** A table from the Stage 14 update that has not been run yet gives an empty report. */
async function stage14<T>(load: () => Promise<T[]>): Promise<T[]> {
  try {
    return await load();
  } catch (e) {
    if (/does not exist|schema cache/i.test(String((e as Error)?.message ?? e))) return [];
    throw e;
  }
}

const OPP_STAGE_LABELS: Record<string, string> = Object.fromEntries(OPP_STAGES.map((s) => [s.key, s.label]));

const pipelineReport: ReportDef = {
  key: "pipeline",
  title: "Sales pipeline",
  group: "sales",
  description: "Opportunities added in the period: stage, value, chance, next step, and why deals were lost.",
  perm: "seeCrm",
  feature: "crm_pipeline",
  date: { label: "Date added" },
  defaultPreset: "this_year",
  filters: ["client", "status"],
  statuses: OPP_STAGE_LABELS,
  defaultStatuses: null,
  defaultLabel: "All stages",
  cols: [
    { key: "number", label: "Number", type: "text", off: true },
    { key: "added", label: "Date added", type: "date" },
    { key: "party", label: "Client or prospect", type: "text" },
    { key: "title", label: "What the client needs", type: "text" },
    { key: "source", label: "How we found it", type: "label", off: true },
    { key: "stage", label: "Stage", type: "label" },
    { key: "owner", label: "Responsible", type: "text" },
    { key: "expected", label: "Expected order date", type: "date", off: true },
    { key: "next", label: "Next step", type: "text", off: true },
    { key: "closed", label: "Closed on", type: "date", off: true },
    { key: "lost_reason", label: "Why lost", type: "text", off: true },
    { key: "currency", label: "Currency", type: "text", off: true },
    { key: "value", label: "Value", type: "money", total: true },
    { key: "chance", label: "Chance", type: "percent", off: true },
    { key: "weighted", label: "Likely value", type: "money", total: true, off: true },
  ],
  sort: { key: "added", dir: "desc" },
  async load(c) {
    type O = { number: string; created_at: string; title: string; prospect_name: string | null; client_id: string | null; source: string; stage: string; owner_id: string | null; expected_close: string | null; next_action: string | null; next_on: string | null; closed_at: string | null; lost_reason: string | null; currency: string; value: number; probability: number; client: Named };
    const rows = await stage14(() =>
      paged<O>((a, b) =>
        onTime(
          c.supabase
            .from("opportunities")
            .select("number, created_at, title, prospect_name, client_id, source, stage, owner_id, expected_close, next_action, next_on, closed_at, lost_reason, currency, value, probability, client:clients(name)")
            .eq("company_id", c.companyId),
          "created_at",
          c,
        ).order("id").range(a, b),
      ),
    );
    const names = await namesFor(c.supabase, rows.map((o) => o.owner_id));
    return rows.map((o) => ({
      number: o.number,
      added: localDay(o.created_at),
      party: one(o.client)?.name ?? o.prospect_name ?? "",
      title: o.title,
      source: OPP_SOURCES.find((x) => x.key === o.source)?.label ?? o.source,
      stage: OPP_STAGE_LABELS[o.stage] ?? o.stage,
      owner: o.owner_id ? (names.get(o.owner_id) ?? "") : "",
      expected: o.expected_close,
      next: [o.next_action, o.next_on].filter(Boolean).join(" · ") || null,
      closed: o.closed_at ? localDay(o.closed_at) : null,
      lost_reason: o.lost_reason,
      currency: o.currency,
      value: n(o.value),
      chance: o.probability,
      weighted: money((n(o.value) * o.probability) / 100),
      _client: o.client_id ?? "",
      _status: o.stage,
    }));
  },
};

const TENDER_STATUS_LABELS: Record<string, string> = Object.fromEntries(TENDER_STATUSES.map((s) => [s.key, s.label]));

const tenderReport: ReportDef = {
  key: "tenders",
  title: "Tenders",
  group: "sales",
  description: "Tenders closing in the period, our price against the winning price, and the result.",
  perm: "seeCrm",
  feature: "tenders",
  date: { label: "Closing date" },
  defaultPreset: "this_year",
  filters: ["client", "status"],
  statuses: TENDER_STATUS_LABELS,
  defaultStatuses: null,
  defaultLabel: "All",
  cols: [
    { key: "number", label: "Number", type: "text", off: true },
    { key: "closing", label: "Closing date", type: "date" },
    { key: "buyer", label: "Buyer", type: "text" },
    { key: "title", label: "Tender for", type: "text" },
    { key: "reference", label: "Tender number", type: "text", off: true },
    { key: "status", label: "Status", type: "label" },
    { key: "currency", label: "Currency", type: "text", off: true },
    { key: "our_price", label: "Our bid price", type: "money", total: true },
    { key: "winning_price", label: "Winning price", type: "money" },
    { key: "gap", label: "Our price vs winner", type: "percent" },
    { key: "winner", label: "Who won", type: "text", off: true },
    { key: "note", label: "Result note", type: "text", off: true },
  ],
  sort: { key: "closing", dir: "desc" },
  async load(c) {
    type T = { number: string; closing_at: string; title: string; buyer_name: string | null; client_id: string | null; reference: string | null; status: string; currency: string; our_price: number | null; winning_price: number | null; winner: string | null; result_note: string | null; client: Named };
    const rows = await stage14(() =>
      paged<T>((a, b) =>
        onTime(
          c.supabase
            .from("tenders")
            .select("number, closing_at, title, buyer_name, client_id, reference, status, currency, our_price, winning_price, winner, result_note, client:clients(name)")
            .eq("company_id", c.companyId),
          "closing_at",
          c,
        ).order("id").range(a, b),
      ),
    );
    return rows.map((t) => {
      const ours = t.our_price === null ? null : n(t.our_price);
      const win = t.winning_price === null ? null : n(t.winning_price);
      return {
        number: t.number,
        closing: localDay(t.closing_at),
        buyer: one(t.client)?.name ?? t.buyer_name ?? "",
        title: t.title,
        reference: t.reference,
        status: TENDER_STATUS_LABELS[t.status] ?? t.status,
        currency: t.currency,
        our_price: ours,
        winning_price: win,
        gap: ours !== null && win !== null && win > 0 ? Math.round(((ours - win) / win) * 1000) / 10 : null,
        winner: t.winner,
        note: t.result_note,
        _client: t.client_id ?? "",
        _status: t.status,
      };
    });
  },
};

const documentReport: ReportDef = {
  key: "documents",
  title: "Documents and expiry dates",
  group: "lists",
  description: "Every document in the library with what it belongs to and when it expires.",
  perm: "seeDocuments",
  feature: "documents",
  date: { label: "Expiry date" },
  defaultPreset: "all",
  filters: ["status"],
  statuses: { valid: "Valid", expiring: "Expiring within 60 days", expired: "Expired", no_expiry: "Does not expire" },
  defaultStatuses: null,
  defaultLabel: "All",
  cols: [
    { key: "title", label: "Document", type: "text" },
    { key: "kind", label: "Type", type: "label" },
    { key: "reference", label: "Number", type: "text", off: true },
    { key: "belongs", label: "Belongs to", type: "text" },
    { key: "issued", label: "Issued on", type: "date", off: true },
    { key: "expires", label: "Expires on", type: "date" },
    { key: "days", label: "Days left", type: "int" },
    { key: "file", label: "File attached", type: "label", off: true },
  ],
  sort: { key: "expires", dir: "asc" },
  async load(c) {
    type D = { title: string; kind: string; reference: string | null; issued_on: string | null; expires_on: string | null; file_path: string | null; product: Named; supplier: Named; client: Named };
    const rows = await stage14(() =>
      paged<D>((a, b) => {
        let q = c.supabase
          .from("documents")
          .select("title, kind, reference, issued_on, expires_on, file_path, product:products(name), supplier:suppliers(name), client:clients(name)")
          .eq("company_id", c.companyId)
          .is("archived_at", null);
        if (c.from || c.to) q = onDate(q, "expires_on", c);
        return q.order("id").range(a, b);
      }),
    );
    const today = Date.parse(`${c.today}T00:00:00Z`);
    return rows.map((d) => {
      const days = d.expires_on ? Math.round((Date.parse(`${d.expires_on}T00:00:00Z`) - today) / 86400000) : null;
      return {
        title: d.title,
        kind: DOC_KINDS.find((k) => k.key === d.kind)?.label ?? d.kind,
        reference: d.reference,
        belongs: one(d.product)?.name ?? one(d.supplier)?.name ?? one(d.client)?.name ?? "",
        issued: d.issued_on,
        expires: d.expires_on,
        days,
        file: d.file_path ? "Yes" : "No",
        _status: days === null ? "no_expiry" : days < 0 ? "expired" : days <= 60 ? "expiring" : "valid",
      };
    });
  },
};

export const REPORTS: ReportDef[] = [
  quotations,
  pipelineReport,
  tenderReport,
  invoices,
  salesByClient,
  salesByProduct,
  purchaseOrders,
  purchasesBySupplier,
  goodsReceived,
  stockOnHand,
  stockMovements,
  deliveries,
  paymentsReceived,
  supplierBills,
  supplierPayments,
  profit,
  profitLoss,
  expenseList,
  expensesByCategory,
  orderCosts,
  clientList,
  supplierList,
  productList,
  documentReport,
];

export function findReport(key: string) {
  return REPORTS.find((r) => r.key === key) ?? null;
}

export const METHOD_LABELS = PAY_METHODS;
export const KIND_LABELS: Record<string, Record<string, string>> = { "stock-movements": MOVEMENT_KINDS, "order-costs": COST_KINDS };
