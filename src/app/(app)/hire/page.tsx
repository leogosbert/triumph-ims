import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext, noAccess } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/lib/sales";
import { HIRE_STATUS, canPlanService, canSeeAllService, todayTz } from "@/lib/services";
import { chargeBetween, isOverdue, type Hire } from "./calc";

export const metadata = { title: "Equipment hire" };

const TABS = [
  { key: "out", label: "Out" },
  { key: "overdue", label: "Overdue" },
  { key: "returned", label: "Returned" },
  { key: "all", label: "All" },
] as const;

const SELECT = "id, number, client_id, site, contact, out_on, due_back_on, returned_on, rate_period, deposit, currency, status, invoiced_until, return_note, notes, created_by, client:clients(name), lines:hire_lines(id, product_id, description, quantity, rate)";

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toLocaleString("en-GB", { maximumFractionDigits: 3 }));

export default async function HirePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!canSeeAllService(roles)) noAccess();
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "out";
  const today = todayTz();
  const monthStart = today.slice(0, 8) + "01";

  const { data, error } = await supabase
    .from("hire_agreements")
    .select(SELECT)
    .eq("company_id", company.id)
    .in("status", ["out", "returned", "invoiced"])
    .or(`status.in.(out,returned),returned_on.gte.${monthStart}`)
    .order("out_on", { ascending: false })
    .limit(1000);
  if (isMissingTable(error)) return <NotReady title="Equipment hire" />;
  if (error) throw new Error(error.message);
  const current = (data ?? []) as unknown as Hire[];

  let list: Hire[];
  if (tab === "all") {
    const { data: all, error: allError } = await supabase
      .from("hire_agreements")
      .select(SELECT)
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(200);
    if (allError) throw new Error(allError.message);
    list = (all ?? []) as unknown as Hire[];
  } else {
    list = current.filter((h) =>
      tab === "out" ? h.status === "out" : tab === "overdue" ? isOverdue(h, today) : h.status === "returned",
    );
    if (tab === "overdue") list.sort((a, b) => (a.due_back_on ?? "").localeCompare(b.due_back_on ?? ""));
  }

  // Stats
  const out = current.filter((h) => h.status === "out");
  const unitsOut = out.reduce((s, h) => s + (h.lines ?? []).reduce((x, l) => x + Number(l.quantity), 0), 0);
  const overdue = out.filter((h) => isOverdue(h, today)).length;
  const valueByCurrency = new Map<string, number>();
  for (const h of current) {
    const from = h.out_on > monthStart ? h.out_on : monthStart;
    const end = h.returned_on && h.returned_on < today ? h.returned_on : today;
    const { amount } = chargeBetween(h.lines, from, end, h.rate_period);
    if (amount > 0) valueByCurrency.set(h.currency, (valueByCurrency.get(h.currency) ?? 0) + amount);
  }
  const valueText = valueByCurrency.size
    ? [...valueByCurrency].map(([c, v]) => formatMoney(v, c)).join(" + ")
    : formatMoney(0, company.base_currency);

  // Hire items: owned, on hire, free.
  const { data: itemData } = await supabase
    .from("products")
    .select("id, name, sku, unit")
    .eq("company_id", company.id)
    .eq("item_type", "hire")
    .eq("active", true)
    .order("name")
    .limit(60);
  const items = (itemData ?? []) as { id: string; name: string; sku: string; unit: string }[];
  const avail = await Promise.all(
    items.map(async (p) => {
      const { data: r } = await supabase.rpc("hire_available", { p_company: company.id, p_product: p.id });
      const row = (Array.isArray(r) ? r[0] : r) as { owned: number; on_hire: number; tracked: boolean } | null;
      return { ...p, owned: Number(row?.owned ?? 0), onHire: Number(row?.on_hire ?? 0), tracked: Boolean(row?.tracked) };
    }),
  );
  const planner = canPlanService(roles);

  return (
    <>
      <div className="page-head">
        <h1>{tr("Equipment hire")}</h1>
        {planner && (
          <Link href="/hire/new" className="btn btn-primary btn-small">
            {tr("+ Hire")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Equipment you own that is out with clients: what is out, what is due back, and invoices per day, week or month.")}</p>
      <Notice {...notice} />
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{qty(unitsOut)}</div>
          <div className="l">{tr("Units out now")}</div>
        </div>
        <div className={`stat ${overdue ? "alert" : ""}`}>
          <div className="n">{overdue}</div>
          <div className="l">{tr("Overdue hires")}</div>
        </div>
        <div className="stat">
          <div className="n">{valueText}</div>
          <div className="l">{tr("Value on hire this month (estimate)")}</div>
        </div>
      </div>
      <nav className="tabs-row" aria-label={tr("Show")}>
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === "out" ? "/hire" : `/hire?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined}>
            {tr(t.label)}
          </Link>
        ))}
      </nav>
      {list.length === 0 ? (
        <p className="card muted">
          {tab === "out"
            ? tr("Nothing is out on hire.")
            : tab === "overdue"
              ? tr("No hires are overdue.")
              : tab === "returned"
                ? tr("No returned hires waiting for an invoice.")
                : tr("No hires yet.")}
        </p>
      ) : (
        <ul className="rec-list">
          {list.map((h) => {
            const units = (h.lines ?? []).reduce((s, l) => s + Number(l.quantity), 0);
            return (
              <li key={h.id}>
                <Link href={`/hire/${h.id}`}>
                  <div className="main">
                    <div className="title">
                      {h.number} <span className="muted">· {h.client?.name}</span>
                    </div>
                    <div className="sub">
                      {qty(units)} {tr("units")} · {formatDate(h.out_on)} → {h.due_back_on ? formatDate(h.due_back_on) : tr("open")}
                      {h.site && ` · ${h.site}`}
                    </div>
                  </div>
                  <div className="side">
                    {isOverdue(h, today) && <span className="badge tone-bad">{tr("Overdue")}</span>} <StatusBadge map={HIRE_STATUS} status={h.status} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <section className="card" style={{ marginTop: 16 }}>
        <div className="page-head">
          <h2 style={{ margin: 0 }}>{tr("Hire items")}</h2>
          {planner && (
            <Link href="/products/new?type=hire" className="btn btn-small">
              {tr("+ Hire item")}
            </Link>
          )}
        </div>
        {avail.length === 0 ? (
          <p className="muted small">{tr("No hire items yet. Add the equipment you rent out as a product of type Hire, then receive the units you own into a store.")}</p>
        ) : (
          <ul className="list">
            {avail.map((p) => (
              <li key={p.id}>
                <Link href={`/products/${p.id}`}>{p.name}</Link> <span className="muted small">{p.sku}</span>
                <div className="small">
                  {p.tracked ? (
                    <>
                      {tr("Owned")} {qty(p.owned)} · {tr("On hire")} {qty(p.onHire)} ·{" "}
                      <strong className={p.owned - p.onHire <= 0 ? "text-warn" : undefined}>
                        {tr("Free")} {qty(Math.max(p.owned - p.onHire, 0))}
                      </strong>{" "}
                      {p.unit}
                    </>
                  ) : (
                    <>
                      {tr("On hire")} {qty(p.onHire)} {p.unit} · <span className="muted">{tr("units owned not counted: receive them into a store")}</span>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
