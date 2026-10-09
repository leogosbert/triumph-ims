import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { fmtQty } from "@/lib/stock";
import { reorderAction } from "./actions";

export const metadata = { title: "What to reorder" };

type Suggestion = {
  product_id: string;
  sku: string;
  name: string;
  unit: string;
  on_hand: number;
  on_order: number;
  reorder_level: number;
  max_level: number | null;
  suggest: number;
  supplier_id: string | null;
  supplier_name: string | null;
  last_cost: number | null;
  last_currency: string | null;
};

export default async function ReorderPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features } = await getAppContext();
  if (!can(role, "seeReorder")) redirect("/stock");
  const { data, error } = await supabase.rpc("reorder_suggestions", { p_company: company.id });
  if (error && /reorder_suggestions|max_level/.test(error.message)) return <NotReady title="What to reorder" />;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Suggestion[];
  const groups = new Map<string, { supplier: string | null; name: string; items: Suggestion[] }>();
  for (const r of rows) {
    const key = r.supplier_id ?? "";
    const g = groups.get(key) ?? { supplier: r.supplier_id, name: r.supplier_name ?? tr("No supplier yet"), items: [] };
    g.items.push(r);
    groups.set(key, g);
  }
  // Groups with a supplier first, then the rest.
  const ordered = [...groups.values()].sort((a, b) => (a.supplier ? 0 : 1) - (b.supplier ? 0 : 1) || a.name.localeCompare(b.name));
  const canPo = can(role, "editPurchasing");
  const canRequest = can(role, "requestPurchases") && features.on("requisitions");

  return (
    <>
      <p className="small">
        <Link href="/stock">{tr("← Stock")}</Link>
      </p>
      <h1>{tr("What to reorder")}</h1>
      <p className="muted small">
        {tr("Products at or below their reorder level. The suggested quantity fills up to the maximum stock level (or twice the reorder level), less what is already ordered or requested.")}
      </p>
      <Notice {...notice} />
      {rows.length === 0 ? (
        <p className="card muted">{tr("Nothing to reorder: every product with a reorder level has enough stock.")}</p>
      ) : (
        ordered.map((g) => (
          <form key={g.supplier ?? "none"} action={reorderAction} className="card">
            <h2>{g.name}</h2>
            <input type="hidden" name="supplier_id" value={g.supplier ?? ""} />
            <ul className="lines">
              {g.items.map((r) => (
                <li key={r.product_id}>
                  <div className="line-head">
                    <label className="check" style={{ alignItems: "flex-start" }}>
                      <input type="checkbox" name="pick" value={r.product_id} defaultChecked={Number(r.suggest) > 0} />{" "}
                      <span>
                        <span className="desc">{r.name}</span>
                        <span className="muted small" style={{ display: "block" }}>
                          {r.sku} · {tr("in stock")} <span className={Number(r.on_hand) <= 0 ? "text-warn" : undefined}>{fmtQty(r.on_hand)}</span> · {tr("reorder at")} {fmtQty(r.reorder_level)}
                          {r.max_level != null && ` · ${tr("max")} ${fmtQty(r.max_level)}`}
                          {Number(r.on_order) > 0 && ` · ${tr("on order")} ${fmtQty(r.on_order)}`}
                          {r.last_cost != null && ` · ${tr("last cost")} ${formatMoney(r.last_cost, r.last_currency ?? company.base_currency)}`}
                        </span>
                      </span>
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        name={`qty_${r.product_id}`}
                        type="text"
                        inputMode="decimal"
                        defaultValue={Number(r.suggest) > 0 ? fmtQty(r.suggest).replace(/,/g, "") : ""}
                        aria-label={`${tr("Quantity")} ${r.name}`}
                        style={{ width: 90 }}
                      />
                      <span className="small muted">{r.unit}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
              {canPo && g.supplier && (
                <SubmitButton name="mode" value="po" pendingText={tr("Creating…")}>
                  {tr("Create draft PO")}
                </SubmitButton>
              )}
              {canRequest && (
                <SubmitButton name="mode" value="request" className={canPo && g.supplier ? "btn" : "btn btn-primary"} pendingText={tr("Creating…")}>
                  {tr("Make a purchase request")}
                </SubmitButton>
              )}
              {canPo && !g.supplier && (
                <Link href="/purchase-orders/new" className="btn">
                  {tr("New purchase order")}
                </Link>
              )}
            </div>
          </form>
        ))
      )}
    </>
  );
}
