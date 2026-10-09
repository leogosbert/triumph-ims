import type { createClient } from "@/lib/supabase/server";
import { n } from "@/lib/finance";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Simple profit & loss for a period, in the base currency.
 *   Sales            issued invoices before VAT (by issue date)
 *   Cost of sales    product cost of what was invoiced (landed cost when applied)
 *   Order costs      transport, bank charges and similar costs added on quotations/orders
 *   Expenses         recorded expenses before VAT, by category (voided ones left out)
 * Net profit = sales − cost of sales − order costs − expenses.
 */
export type Pnl = {
  sales: number;
  cogs: number;
  gross: number;
  orderCosts: number;
  expenses: number;
  byCategory: Map<string, number>;
  net: number;
  invoices: number;
  linesWithoutCost: number;
};

export async function loadPnl(supabase: Supabase, companyId: string, from: string, to: string, withExpenses: boolean): Promise<Pnl> {
  const [{ data: pData, error }, { data: costData }, exp] = await Promise.all([
    supabase
      .from("invoice_profit")
      .select("revenue_base, cost_base, lines_without_cost")
      .eq("company_id", companyId)
      .gte("issue_date", from)
      .lt("issue_date", to)
      .limit(20000),
    supabase
      .from("order_costs")
      .select("amount, exchange_rate")
      .eq("company_id", companyId)
      .not("quotation_id", "is", null)
      .gte("incurred_on", from)
      .lt("incurred_on", to)
      .limit(20000),
    withExpenses
      ? supabase
          .from("expenses")
          .select("category_id, amount, vat_amount, exchange_rate")
          .eq("company_id", companyId)
          .is("voided_at", null)
          .gte("spent_on", from)
          .lt("spent_on", to)
          .limit(20000)
      : Promise.resolve({ data: [] as { category_id: string; amount: number; vat_amount: number; exchange_rate: number }[] }),
  ]);
  if (error) throw new Error(error.message);
  let sales = 0;
  let cogs = 0;
  let missing = 0;
  const rows = (pData ?? []) as { revenue_base: number; cost_base: number; lines_without_cost: number }[];
  for (const r of rows) {
    sales += n(r.revenue_base);
    cogs += n(r.cost_base);
    missing += n(r.lines_without_cost);
  }
  const orderCosts = ((costData ?? []) as { amount: number; exchange_rate: number }[]).reduce((s, c) => s + n(c.amount) * n(c.exchange_rate), 0);
  const byCategory = new Map<string, number>();
  let expenses = 0;
  for (const e of (exp.data ?? []) as { category_id: string; amount: number; vat_amount: number; exchange_rate: number }[]) {
    const v = (n(e.amount) - n(e.vat_amount)) * n(e.exchange_rate);
    expenses += v;
    byCategory.set(e.category_id, (byCategory.get(e.category_id) ?? 0) + v);
  }
  const gross = sales - cogs;
  return { sales, cogs, gross, orderCosts, expenses, byCategory, net: gross - orderCosts - expenses, invoices: rows.length, linesWithoutCost: missing };
}
