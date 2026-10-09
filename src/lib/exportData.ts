import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Everything a company owns, table by table, for backups and for moving to other software. */
export const EXPORT_TABLES: { table: string; label: string }[] = [
  { table: "clients", label: "Clients" },
  { table: "client_contacts", label: "Client contacts" },
  { table: "suppliers", label: "Suppliers" },
  { table: "products", label: "Products" },
  { table: "product_costs", label: "Product costs" },
  { table: "exchange_rates", label: "Exchange rates" },
  { table: "warehouses", label: "Stores" },
  { table: "rfqs", label: "Client RFQs" },
  { table: "rfq_lines", label: "Client RFQ items" },
  { table: "quotations", label: "Quotations" },
  { table: "quotation_lines", label: "Quotation items" },
  { table: "supplier_rfqs", label: "Supplier RFQs" },
  { table: "purchase_orders", label: "Purchase orders" },
  { table: "po_lines", label: "Purchase order items" },
  { table: "goods_receipts", label: "Goods received notes" },
  { table: "grn_lines", label: "Goods received items" },
  { table: "stock_movements", label: "Stock movements" },
  { table: "deliveries", label: "Delivery notes" },
  { table: "delivery_lines", label: "Delivery items" },
  { table: "invoices", label: "Invoices" },
  { table: "invoice_lines", label: "Invoice items" },
  { table: "payments", label: "Payments received" },
  { table: "supplier_bills", label: "Supplier bills" },
  { table: "supplier_payments", label: "Payments to suppliers" },
  { table: "order_costs", label: "Order and import costs" },
  { table: "expense_categories", label: "Expense categories" },
  { table: "expenses", label: "Expenses" },
  { table: "followups", label: "Follow-ups and reminders" },
  { table: "memberships", label: "Team and roles" },
  { table: "audit_log", label: "Activity log" },
];

export async function fetchAll(supabase: Supabase, table: string, companyId: string) {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("company_id", companyId)
      .order(table === "product_costs" ? "product_id" : "id", { ascending: true }) // stable order for paging
      .range(from, from + 999);
    // A table from a database update that has not been run yet: nothing to export.
    if (error && (error.code === "PGRST205" || error.code === "42P01")) return rows;
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export function toCsv(rows: Record<string, unknown>[]) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    // Leading = + - @ would be run as formulas by Excel: prefix with a quote.
    const safe = /^[=+\-@]/.test(s) && Number.isNaN(Number(s)) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\r\n");
}
