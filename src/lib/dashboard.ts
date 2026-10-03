import type { createClient } from "@/lib/supabase/server";
import { agingBucket, daysOverdue, n, openBase } from "@/lib/finance";
import { can, type Role } from "@/lib/roles";
import { todayTz } from "@/lib/sales";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type TowerItem = { label: string; count: number; href: string; detail?: string };
export type Tower = { critical: TowerItem[]; attention: TowerItem[]; normal: TowerItem[] };
export type Kpi = { label: string; value: number; money?: boolean; suffix?: string; href?: string; alert?: boolean };
export type MonthBar = { month: string; label: string; sales: number; profit: number };
export type NamedValue = { label: string; value: number };

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Everything the home dashboard shows, limited to what this role may see. */
export async function loadDashboard(supabase: Supabase, companyId: string, role: Role) {
  const today = todayTz();
  const monthStart = `${today.slice(0, 7)}-01`;
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const sixStart = (() => {
    const [y, m] = today.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 6, 1));
    return d.toISOString().slice(0, 10);
  })();

  const sales = can(role, "seeSales");
  const purchasing = can(role, "seePurchasing");
  const stock = can(role, "seeStock");
  const deliveries = can(role, "seeDeliveries");
  const finance = can(role, "seeFinance");
  const profit = can(role, "seeProfit");
  const costs = can(role, "seeCosts");
  const none = Promise.resolve({ data: null, count: null });

  const [
    rfqs,
    quotes,
    pos,
    soh,
    products,
    dns,
    invoices,
    bills,
    invoicedDns,
    profitRows,
    extras,
    productCosts,
    clients,
  ] = await Promise.all([
    sales ? supabase.from("rfqs").select("id, status, due_on").eq("company_id", companyId).in("status", ["new", "quoting"]).limit(5000) : none,
    sales
      ? supabase
          .from("quotations")
          .select("id, status, valid_until, decided_at, total, exchange_rate")
          .eq("company_id", companyId)
          .in("status", ["pending_approval", "approved", "sent", "accepted", "rejected"])
          .limit(5000)
      : none,
    purchasing
      ? supabase
          .from("purchase_orders")
          .select("id, status, expected_date")
          .eq("company_id", companyId)
          .in("status", ["pending_approval", "approved", "sent", "confirmed", "partially_received"])
          .limit(5000)
      : none,
    stock ? supabase.from("stock_on_hand").select("product_id, expiry_date, quantity").eq("company_id", companyId).limit(20000) : none,
    stock ? supabase.from("products").select("id, reorder_level").eq("company_id", companyId).eq("active", true).gt("reorder_level", 0).limit(5000) : none,
    deliveries
      ? supabase.from("deliveries").select("id, status, updated_at").eq("company_id", companyId).in("status", ["draft", "dispatched", "delivered", "failed"]).limit(5000)
      : none,
    finance
      ? supabase
          .from("invoices")
          .select("id, status, due_date, total, amount_paid, exchange_rate")
          .eq("company_id", companyId)
          .in("status", ["issued", "partly_paid"])
          .limit(5000)
      : none,
    finance
      ? supabase.from("supplier_bills").select("id, due_date, total, amount_paid, exchange_rate").eq("company_id", companyId).in("status", ["open", "partly_paid"]).limit(5000)
      : none,
    finance ? supabase.from("invoices").select("delivery_id").eq("company_id", companyId).neq("status", "cancelled").not("delivery_id", "is", null) : none,
    profit
      ? supabase.from("invoice_profit").select("client_id, issue_date, revenue_base, cost_base").eq("company_id", companyId).gte("issue_date", sixStart < yearStart ? sixStart : yearStart).limit(20000)
      : none,
    profit
      ? supabase.from("order_costs").select("amount, exchange_rate, incurred_on").eq("company_id", companyId).not("quotation_id", "is", null).gte("incurred_on", sixStart).limit(20000)
      : none,
    costs && stock ? supabase.from("product_costs").select("product_id, last_cost").eq("company_id", companyId).limit(20000) : none,
    profit ? supabase.from("clients").select("id, name, industry").eq("company_id", companyId).limit(5000) : none,
  ]);

  const tower: Tower = { critical: [], attention: [], normal: [] };
  const push = (level: keyof Tower, item: TowerItem) => {
    if (item.count > 0) tower[level].push(item);
  };

  // ----- Sales -----
  const rfqRows = (rfqs.data ?? []) as { status: string; due_on: string | null }[];
  const qRows = (quotes.data ?? []) as { status: string; valid_until: string | null; decided_at: string | null; total: number; exchange_rate: number }[];
  if (sales) {
    push("critical", { label: "Client RFQs overdue", count: rfqRows.filter((r) => r.due_on && r.due_on < today).length, href: "/rfqs" });
    push("attention", { label: "RFQs due within 2 days", count: rfqRows.filter((r) => r.due_on && r.due_on >= today && r.due_on <= addDays(today, 2)).length, href: "/rfqs" });
    push("attention", { label: "Quotations waiting for approval", count: qRows.filter((q) => q.status === "pending_approval").length, href: "/quotations?tab=approval" });
    push("attention", {
      label: "Quotations expiring within 3 days",
      count: qRows.filter((q) => ["approved", "sent"].includes(q.status) && q.valid_until && q.valid_until >= today && q.valid_until <= addDays(today, 3)).length,
      href: "/quotations?tab=sent",
    });
    push("normal", { label: "Open client RFQs", count: rfqRows.length, href: "/rfqs" });
    push("normal", { label: "Quotations with clients", count: qRows.filter((q) => q.status === "sent").length, href: "/quotations?tab=sent" });
  }

  // ----- Purchasing -----
  const poRows = (pos.data ?? []) as { status: string; expected_date: string | null }[];
  if (purchasing) {
    push("critical", {
      label: "Supplier deliveries late",
      count: poRows.filter((p) => p.status !== "pending_approval" && p.expected_date && p.expected_date < today).length,
      href: "/purchase-orders?tab=incoming",
    });
    push("attention", { label: "Purchase orders waiting for approval", count: poRows.filter((p) => p.status === "pending_approval").length, href: "/purchase-orders?tab=approval" });
    push("normal", { label: "Purchase orders awaiting goods", count: poRows.filter((p) => ["sent", "confirmed", "partially_received"].includes(p.status)).length, href: "/purchase-orders?tab=incoming" });
  }

  // ----- Stock -----
  const sohRows = (soh.data ?? []) as { product_id: string; expiry_date: string | null; quantity: number }[];
  const onHand = new Map<string, number>();
  for (const s of sohRows) onHand.set(s.product_id, (onHand.get(s.product_id) ?? 0) + n(s.quantity));
  if (stock) {
    const live = sohRows.filter((s) => n(s.quantity) > 0 && s.expiry_date);
    push("critical", { label: "Batches expired or expiring within 7 days", count: live.filter((s) => s.expiry_date! <= addDays(today, 7)).length, href: "/stock" });
    push("attention", {
      label: "Batches expiring within 60 days",
      count: live.filter((s) => s.expiry_date! > addDays(today, 7) && s.expiry_date! <= addDays(today, 60)).length,
      href: "/stock",
    });
    const prodRows = (products.data ?? []) as { id: string; reorder_level: number }[];
    push("attention", { label: "Products at or below reorder level", count: prodRows.filter((p) => (onHand.get(p.id) ?? 0) <= n(p.reorder_level)).length, href: "/stock#low" });
  }

  // ----- Deliveries -----
  const dnRows = (dns.data ?? []) as { id: string; status: string; updated_at: string }[];
  if (deliveries) {
    const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString();
    push("critical", { label: "Failed deliveries (last 7 days)", count: dnRows.filter((d) => d.status === "failed" && d.updated_at >= weekAgo).length, href: "/deliveries?tab=problems" });
    push("normal", { label: "Deliveries on the way", count: dnRows.filter((d) => d.status === "dispatched").length, href: "/deliveries?tab=dispatched" });
    push("normal", { label: "Delivery notes being prepared", count: dnRows.filter((d) => d.status === "draft").length, href: "/deliveries" });
  }

  // ----- Finance -----
  const invRows = (invoices.data ?? []) as { id: string; due_date: string | null; total: number; amount_paid: number; exchange_rate: number }[];
  const billRows = (bills.data ?? []) as { due_date: string | null; total: number; amount_paid: number; exchange_rate: number }[];
  const aging = [0, 0, 0, 0, 0];
  for (const i of invRows) aging[agingBucket(i.due_date)] += openBase(i);
  if (finance) {
    push("critical", { label: "Invoices more than 60 days overdue", count: invRows.filter((i) => daysOverdue(i.due_date) > 60).length, href: "/invoices?tab=overdue" });
    push("attention", {
      label: "Invoices overdue",
      count: invRows.filter((i) => daysOverdue(i.due_date) > 0 && daysOverdue(i.due_date) <= 60).length,
      href: "/invoices?tab=overdue",
    });
    push("attention", { label: "Supplier bills due within 7 days or late", count: billRows.filter((b) => b.due_date && daysOverdue(b.due_date) >= -7).length, href: "/bills" });
    const done = new Set(((invoicedDns.data ?? []) as { delivery_id: string }[]).map((r) => r.delivery_id));
    push("attention", { label: "Delivered but not invoiced", count: dnRows.filter((d) => d.status === "delivered" && !done.has(d.id)).length, href: "/invoices/new" });
    push("normal", { label: "Unpaid invoices", count: invRows.length, href: "/invoices" });
  }

  // ----- KPIs and charts -----
  const pRows = (profitRows.data ?? []) as { client_id: string; issue_date: string; revenue_base: number; cost_base: number }[];
  const xRows = (extras.data ?? []) as { amount: number; exchange_rate: number; incurred_on: string }[];
  const months: MonthBar[] = [];
  {
    const [y, m] = today.split("-").map(Number);
    for (let k = 5; k >= 0; k--) {
      const d = new Date(Date.UTC(y, m - 1 - k, 1));
      const key = d.toISOString().slice(0, 7);
      months.push({ month: key, label: d.toLocaleString("en-GB", { month: "short", timeZone: "UTC" }), sales: 0, profit: 0 });
    }
  }
  for (const r of pRows) {
    const mb = months.find((x) => x.month === r.issue_date.slice(0, 7));
    if (mb) {
      mb.sales += n(r.revenue_base);
      mb.profit += n(r.revenue_base) - n(r.cost_base);
    }
  }
  for (const x of xRows) {
    const mb = months.find((m) => m.month === x.incurred_on.slice(0, 7));
    if (mb) mb.profit -= n(x.amount) * n(x.exchange_rate);
  }
  const thisMonth = months[months.length - 1];

  const clientRows = (clients.data ?? []) as { id: string; name: string; industry: string | null }[];
  const clientMap = new Map(clientRows.map((c) => [c.id, c]));
  const byIndustry = new Map<string, number>();
  const byClient = new Map<string, number>();
  for (const r of pRows.filter((r) => r.issue_date >= yearStart)) {
    const c = clientMap.get(r.client_id);
    byIndustry.set(c?.industry ?? "Not set", (byIndustry.get(c?.industry ?? "Not set") ?? 0) + n(r.revenue_base));
    byClient.set(c?.name ?? "Client", (byClient.get(c?.name ?? "Client") ?? 0) + n(r.revenue_base));
  }
  const top = (m: Map<string, number>, k: number): NamedValue[] =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([label, value]) => ({ label, value }));

  const costMap = new Map(((productCosts.data ?? []) as { product_id: string; last_cost: number | null }[]).map((c) => [c.product_id, n(c.last_cost)]));
  const stockValue = [...onHand.entries()].reduce((s, [pid, q]) => s + Math.max(0, q) * (costMap.get(pid) ?? 0), 0);

  const ninety = addDays(today, -90);
  const decided = qRows.filter((q) => q.decided_at && q.decided_at.slice(0, 10) >= ninety && ["accepted", "rejected"].includes(q.status));
  const won = decided.filter((q) => q.status === "accepted");
  const wonMonth = qRows.filter((q) => q.status === "accepted" && q.decided_at && q.decided_at.slice(0, 10) >= monthStart);

  const kpis: Kpi[] = [];
  if (profit) {
    kpis.push({ label: "Sales this month (before VAT)", value: thisMonth.sales, money: true, href: "/profit" });
    kpis.push({ label: "Gross profit this month", value: thisMonth.profit, money: true, href: "/profit" });
  }
  if (finance) {
    kpis.push({ label: "Owed to us", value: aging.reduce((a, b) => a + b, 0), money: true, href: "/receivables", alert: aging[3] + aging[4] > 0 });
    kpis.push({ label: "We owe suppliers", value: billRows.reduce((s, b) => s + openBase(b), 0), money: true, href: "/payables" });
  }
  if (costs && stock) kpis.push({ label: "Stock value (at cost)", value: stockValue, money: true, href: "/stock" });
  if (sales) {
    kpis.push({ label: "Orders won this month", value: wonMonth.length, href: "/quotations?tab=accepted" });
    kpis.push({ label: "Win rate, last 90 days", value: decided.length ? Math.round((won.length / decided.length) * 100) : 0, suffix: "%", href: "/quotations?tab=accepted" });
  }

  return {
    tower,
    kpis,
    months: profit ? months : null,
    aging: finance ? aging : null,
    industries: profit ? top(byIndustry, 6) : null,
    clients: profit ? top(byClient, 5) : null,
  };
}
