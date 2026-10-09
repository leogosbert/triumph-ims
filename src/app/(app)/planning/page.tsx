import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { fmtQty } from "@/lib/stock";
import { planningAction } from "./actions";

export const metadata = { title: "Purchase planning" };

type Plan = {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  sold: number;
  per_day: number;
  on_hand: number;
  on_order: number;
  lead_days: number;
  cover_days: number | null;
  reorder_point: number;
  order_qty: number;
  supplier_id: string | null;
  supplier_name: string | null;
  reorder_level: number | null;
  max_level: number | null;
};

const PERIODS = [30, 90, 180];

export default async function PlanningPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features } = await getAppContext();
  if (!can(role, "planPurchases")) redirect("/");
  const days = PERIODS.includes(Number(sp.days)) ? Number(sp.days) : 90;
  const view = sp.view === "all" ? "all" : "order";
  const { data, error } = await supabase.rpc("demand_plan", { p_company: company.id, p_days: days });
  if (error && /demand_plan/.test(error.message)) return <NotReady title="Purchase planning" />;
  if (error) throw new Error(error.message);
  const all = (data ?? []) as Plan[];
  const rows = view === "all" ? all : all.filter((r) => Number(r.order_qty) > 0 && Number(r.on_hand) + Number(r.on_order) <= Number(r.reorder_point));
  const groups = new Map<string, { supplier: string | null; name: string; items: Plan[] }>();
  for (const r of rows) {
    const key = r.supplier_id ?? "";
    const g = groups.get(key) ?? { supplier: r.supplier_id, name: r.supplier_name ?? tr("No supplier yet"), items: [] };
    g.items.push(r);
    groups.set(key, g);
  }
  const ordered = [...groups.values()].sort((a, b) => (a.supplier ? 0 : 1) - (b.supplier ? 0 : 1) || a.name.localeCompare(b.name));
  const canPo = can(role, "editPurchasing");
  const canRequest = can(role, "requestPurchases") && features.on("requisitions");
  const canLevels = can(role, "editProducts");
  const qs = (d: number, v: string) => `/planning?days=${d}${v === "all" ? "&view=all" : ""}`;

  return (
    <>
      <p className="small">
        <Link href="/stock">{tr("← Stock")}</Link>
      </p>
      <h1>{tr("Purchase planning")}</h1>
      <p className="muted small">
        {tr("From what you dispatched: sales per day, how long the stock lasts, and when to order given the supplier's lead time (two weeks when not known) plus a week of safety stock. The quantity covers a month after the goods arrive.")}
      </p>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href={qs(days, "order")} aria-current={view === "order" ? "page" : undefined}>
          {tr("Order now")}
        </Link>
        <Link href={qs(days, "all")} aria-current={view === "all" ? "page" : undefined}>
          {tr("Everything that sells")}
        </Link>
      </nav>
      <p className="small">
        {tr("Based on the last")}{" "}
        {PERIODS.map((d, i) => (
          <span key={d}>
            {i > 0 && " · "}
            {d === days ? <strong>{d}</strong> : <Link href={qs(d, view)}>{d}</Link>}
          </span>
        ))}{" "}
        {tr("days")}
      </p>
      {rows.length === 0 ? (
        <p className="card muted">
          {all.length === 0 ? tr("No dispatches in this period yet: planning starts once goods go out on delivery notes.") : tr("Nothing needs ordering now.")}
        </p>
      ) : (
        ordered.map((g) => (
          <form key={g.supplier ?? "none"} action={planningAction} className="card">
            <h2>{g.name}</h2>
            <input type="hidden" name="supplier_id" value={g.supplier ?? ""} />
            <input type="hidden" name="days" value={days} />
            <input type="hidden" name="back" value="planning" />
            <ul className="lines">
              {g.items.map((r) => {
                const left = Number(r.on_hand) + Number(r.on_order);
                const late = r.cover_days !== null && Number(r.cover_days) < r.lead_days;
                return (
                  <li key={r.product_id}>
                    <div className="line-head">
                      <label className="check" style={{ alignItems: "flex-start" }}>
                        <input type="checkbox" name="pick" value={r.product_id} defaultChecked={Number(r.order_qty) > 0 && left <= Number(r.reorder_point)} />{" "}
                        <span>
                          <span className="desc">{r.name}</span>
                          <span className="muted small" style={{ display: "block" }}>
                            {fmtQty(r.per_day)} {r.unit}/{tr("day")} · {tr("in stock")} {fmtQty(r.on_hand)}
                            {Number(r.on_order) > 0 && ` · ${tr("on order")} ${fmtQty(r.on_order)}`} ·{" "}
                            <span className={late ? "text-warn" : undefined}>
                              {r.cover_days === null ? "—" : `${fmtQty(r.cover_days)} ${tr("days of stock")}`}
                            </span>{" "}
                            · {tr("lead time")} {r.lead_days} {tr("days")} · {tr("reorder at")} {fmtQty(r.reorder_point)}
                            {r.reorder_level != null && Number(r.reorder_level) !== Number(r.reorder_point) && ` (${tr("now")} ${fmtQty(r.reorder_level)})`}
                          </span>
                        </span>
                      </label>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          name={`qty_${r.product_id}`}
                          type="text"
                          inputMode="decimal"
                          defaultValue={Number(r.order_qty) > 0 ? String(Number(r.order_qty)) : ""}
                          aria-label={`${tr("Quantity")} ${r.name}`}
                          style={{ width: 90 }}
                        />
                        <span className="small muted">{r.unit}</span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
              {canPo && g.supplier && (
                <SubmitButton name="mode" value="po" pendingText={tr("Creating…")}>
                  {tr("Create draft PO")}
                </SubmitButton>
              )}
              {canRequest && (
                <SubmitButton name="mode" value="request" className="btn" pendingText={tr("Creating…")}>
                  {tr("Make a purchase request")}
                </SubmitButton>
              )}
              {canLevels && (
                <SubmitButton name="mode" value="levels" className="btn" pendingText="…">
                  {tr("Set as reorder levels")}
                </SubmitButton>
              )}
            </div>
          </form>
        ))
      )}
    </>
  );
}
