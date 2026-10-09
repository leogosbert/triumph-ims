import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { productOptions } from "@/lib/options";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { TRANSFER_STATUS, fmtQty, storeOptions } from "@/lib/stock";
import { addTransferLine, removeTransferLine, transferAction } from "../actions";

export const metadata = { title: "Stock transfer" };

type Line = { id: string; product_id: string; quantity: number; note: string | null; product: { name: string; sku: string; unit: string } | null };

export default async function TransferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeStock")) redirect("/");
  const { data: t, error } = await supabase.from("stock_transfers").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Stock transfer" />;
  if (!t) notFound();
  const [{ data: lineData }, storeList, products, { data: stockData }] = await Promise.all([
    supabase.from("stock_transfer_lines").select("id, product_id, quantity, note, product:products(name, sku, unit)").eq("transfer_id", id).order("created_at"),
    storeOptions(supabase, company.id, false),
    productOptions(supabase, company.id),
    supabase.from("stock_on_hand").select("product_id, quantity").eq("company_id", company.id).eq("warehouse_id", t.from_warehouse_id).limit(10000),
  ]);
  const lines = (lineData ?? []) as unknown as Line[];
  const stores = new Map(storeList.map((s) => [s.id, s.name]));
  const onHand = new Map<string, number>();
  for (const s of stockData ?? []) onHand.set(s.product_id, (onHand.get(s.product_id) ?? 0) + Number(s.quantity));
  const names = await namesFor(supabase, [t.created_by, t.sent_by, t.received_by]);
  const mover = can(role, "moveStock");
  const draft = t.status === "draft";
  const short = draft ? lines.filter((l) => Number(l.quantity) > (onHand.get(l.product_id) ?? 0)) : [];
  // Products with stock in the source store first.
  const choices = [...products].sort((a, b) => Number((onHand.get(b.id) ?? 0) > 0) - Number((onHand.get(a.id) ?? 0) > 0));

  return (
    <>
      <p className="small">
        <Link href="/transfers">{tr("← Stock transfers")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>
          {stores.get(t.from_warehouse_id)} → {stores.get(t.to_warehouse_id)}
        </h1>
        <StatusBadge map={TRANSFER_STATUS} status={t.status} />
      </div>
      <p className="muted small">
        {t.number}
        {t.reason && ` · ${t.reason}`}
        {t.vehicle && ` · ${t.vehicle}`}
        {t.created_by && names.get(t.created_by) && ` · ${tr("prepared by")} ${names.get(t.created_by)}`}
      </p>
      {(t.sent_at || t.received_at) && (
        <p className="small">
          {t.sent_at && `${tr("Sent")} ${formatDateTime(t.sent_at)}${t.sent_by && names.get(t.sent_by) ? ` · ${names.get(t.sent_by)}` : ""}`}
          {t.received_at && ` · ${tr("Received")} ${formatDateTime(t.received_at)}${t.received_by && names.get(t.received_by) ? ` · ${names.get(t.received_by)}` : ""}`}
        </p>
      )}
      {t.receive_note && <p className="small">{t.receive_note}</p>}
      {t.notes && <p className="small muted">{t.notes}</p>}
      <Notice {...notice} />

      <section className="card" id="items">
        <h2>
          {tr("Items")} <span className="small muted">· {lines.length}</span>
        </h2>
        {lines.length === 0 ? (
          <p className="muted small">{tr("No items yet. Add what you are moving below.")}</p>
        ) : (
          <ul className="lines">
            {lines.map((l) => {
              const have = onHand.get(l.product_id) ?? 0;
              return (
                <li key={l.id}>
                  <div className="line-head">
                    <div>
                      <div className="desc">{l.product?.name}</div>
                      <div className="muted small">
                        {l.product?.sku}
                        {draft && (
                          <span className={Number(l.quantity) > have ? "text-warn" : undefined}>
                            {" "}
                            · {tr("in the store")} {fmtQty(have)}
                          </span>
                        )}
                        {l.note && ` · ${l.note}`}
                      </div>
                    </div>
                    <strong style={{ whiteSpace: "nowrap" }}>
                      {fmtQty(l.quantity)} {l.product?.unit}
                    </strong>
                  </div>
                  {draft && mover && (
                    <form action={removeTransferLine}>
                      <input type="hidden" name="transfer_id" value={t.id} />
                      <input type="hidden" name="line_id" value={l.id} />
                      <button type="submit" className="btn btn-small">
                        {tr("Remove")}
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {draft && mover && (
          <form action={addTransferLine} style={{ marginTop: 12 }}>
            <input type="hidden" name="transfer_id" value={t.id} />
            <div className="grid grid-2">
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="product_id">{tr("Product")}</label>
                <select id="product_id" name="product_id" required defaultValue="">
                  <option value="" disabled>
                    {tr("Choose…")}
                  </option>
                  {choices.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku}) · {fmtQty(onHand.get(p.id) ?? 0)} {p.unit}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="quantity">{tr("Quantity")}</label>
                <input id="quantity" name="quantity" type="text" inputMode="decimal" required />
              </div>
              <div className="field">
                <label htmlFor="note">{tr("Note")}</label>
                <input id="note" name="note" type="text" maxLength={300} />
              </div>
            </div>
            <SubmitButton className="btn btn-small">{tr("Add item")}</SubmitButton>
          </form>
        )}
      </section>

      {mover && (draft || t.status === "in_transit") && (
        <section className="card">
          {draft && (
            <>
              {short.length > 0 && (
                <p className="banner warn small">
                  {tr("Not enough in the store for")}: {short.map((l) => l.product?.name).join(", ")}
                </p>
              )}
              <p className="small muted">{tr("Sending takes the stock out of the first store (oldest expiry first). It arrives in the second store when someone receives it.")}</p>
              <form action={transferAction}>
                <input type="hidden" name="id" value={t.id} />
                <input type="hidden" name="action" value="send" />
                <SubmitButton disabled={lines.length === 0 || short.length > 0}>{tr("Send now")}</SubmitButton>
              </form>
            </>
          )}
          {t.status === "in_transit" && (
            <form action={transferAction}>
              <input type="hidden" name="id" value={t.id} />
              <input type="hidden" name="action" value="receive" />
              <div className="field">
                <label htmlFor="receive_note">{tr("Note on arrival")}</label>
                <input id="receive_note" name="note" type="text" maxLength={500} placeholder={tr("e.g. All arrived in good condition")} />
              </div>
              <SubmitButton>{tr("Mark as received")}</SubmitButton>
            </form>
          )}
          <form action={transferAction} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={t.id} />
            <input type="hidden" name="action" value="cancel" />
            <SubmitButton className="btn btn-small" pendingText="…">
              {t.status === "in_transit" ? tr("Cancel and return the stock") : tr("Cancel transfer")}
            </SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}
