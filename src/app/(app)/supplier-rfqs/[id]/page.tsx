import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { ProductLineFields } from "@/components/ProductPicker";
import { SharePdfButton } from "@/components/SharePdfButton";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { productOptions } from "@/lib/options";
import { INVITE_STATUS, SRFQ_STATUS } from "@/lib/purchasing";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import {
  addSrfqLine,
  awardSupplier,
  cancelSrfq,
  inviteSupplier,
  removeInvite,
  removeSrfqLine,
  saveSrfqHeader,
  setDeclined,
} from "../actions";

export const metadata = { title: "Supplier RFQ" };

type Line = { id: string; line_no: number; description: string; quantity: number; unit: string; product: { sku: string } | null };
type Invite = {
  id: string;
  supplier_id: string;
  status: string;
  currency: string;
  exchange_rate: number;
  freight: number;
  lead_time_days: number | null;
  payment_terms: string | null;
  incoterms: string | null;
  valid_until: string | null;
  supplier: { name: string; code: string; country: string | null } | null;
};
type QuoteLine = { srfq_supplier_id: string; srfq_line_id: string; unit_price: number | null };

const n = (v: unknown) => Number(v ?? 0);

export default async function SupplierRfqPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editPurchasing")) redirect("/");

  const { data: r } = await supabase.from("supplier_rfqs").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!r) notFound();
  const [{ data: lineData }, { data: inviteData }, { data: suppliersData }, { data: poData }] = await Promise.all([
    supabase.from("supplier_rfq_lines").select("id, line_no, description, quantity, unit, product:products(sku)").eq("srfq_id", id).order("line_no"),
    supabase
      .from("supplier_rfq_suppliers")
      .select("id, supplier_id, status, currency, exchange_rate, freight, lead_time_days, payment_terms, incoterms, valid_until, supplier:suppliers(name, code, country)")
      .eq("srfq_id", id)
      .order("created_at"),
    supabase.from("suppliers").select("id, name, code").eq("company_id", company.id).eq("active", true).order("name"),
    supabase.from("purchase_orders").select("id, number, status").eq("srfq_id", id),
  ]);
  const lines = (lineData ?? []) as unknown as Line[];
  const invites = (inviteData ?? []) as unknown as Invite[];
  const suppliers = (suppliersData ?? []) as { id: string; name: string; code: string }[];
  const pos = (poData ?? []) as { id: string; number: string; status: string }[];
  const open = r.status === "open";
  const products = open ? await productOptions(supabase, company.id) : [];

  const { data: qlData } = invites.length
    ? await supabase.from("supplier_quote_lines").select("srfq_supplier_id, srfq_line_id, unit_price").in("srfq_supplier_id", invites.map((i) => i.id))
    : { data: [] };
  const price = new Map<string, number | null>();
  for (const q of (qlData ?? []) as QuoteLine[]) price.set(`${q.srfq_supplier_id}:${q.srfq_line_id}`, q.unit_price === null ? null : n(q.unit_price));

  // Comparison in base currency.
  const base = company.base_currency;
  const quoted = invites.filter((i) => i.status === "quoted");
  const summary = quoted.map((inv) => {
    let total = 0;
    let count = 0;
    for (const l of lines) {
      const p = price.get(`${inv.id}:${l.id}`);
      if (p !== null && p !== undefined) {
        total += p * n(inv.exchange_rate) * n(l.quantity);
        count++;
      }
    }
    total += n(inv.freight) * n(inv.exchange_rate);
    return { inv, total, count, complete: count === lines.length };
  });
  const completeTotals = summary.filter((s) => s.complete).map((s) => s.total);
  const bestTotal = completeTotals.length ? Math.min(...completeTotals) : null;
  const bestPerLine = new Map<string, number>();
  for (const l of lines) {
    const vals = quoted
      .map((inv) => {
        const p = price.get(`${inv.id}:${l.id}`);
        return p === null || p === undefined ? null : p * n(inv.exchange_rate);
      })
      .filter((v): v is number => v !== null);
    if (vals.length) bestPerLine.set(l.id, Math.min(...vals));
  }
  const invitedIds = new Set(invites.map((i) => i.supplier_id));

  return (
    <>
      <p className="small">
        <Link href="/supplier-rfqs">{tr("← Supplier RFQs")}</Link>
        {r.quotation_id && (
          <>
            {" · "}
            <Link href={`/quotations/${r.quotation_id}`}>{tr("Client quotation")}</Link>
          </>
        )}
        {r.rfq_id && (
          <>
            {" · "}
            <Link href={`/rfqs/${r.rfq_id}`}>{tr("Client RFQ")}</Link>
          </>
        )}
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{r.title ?? r.number}</h1>
        <StatusBadge map={SRFQ_STATUS} status={r.status} />
      </div>
      <p className="muted small">
        {r.number}
        {r.due_on && <>{" "}{tr("· reply by")}{" "}{formatDate(r.due_on)}</>}
        {r.delivery_location && <>{" "}{tr("· deliver to")}{" "}{r.delivery_location}</>}
      </p>
      <Notice {...notice} />

      {pos.length > 0 && (
        <div className="banner ok">{tr("Purchase order")}{pos.length > 1 ? "s" : ""}:{" "}
          {pos.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ", "}
              <Link href={`/purchase-orders/${p.id}`}>{p.number}</Link>
            </span>
          ))}
        </div>
      )}

      <section className="card" id="items">
        <h2>{tr("Items (")}{lines.length})</h2>
        {lines.length === 0 && <p className="muted small">{tr("No items yet.")}</p>}
        <ul className="lines">
          {lines.map((l) => (
            <li key={l.id} className="line-head">
              <div>
                <div className="desc">
                  {l.line_no}. {l.description}
                </div>
                <div className="muted small">
                  {n(l.quantity).toLocaleString("en-GB")} {l.unit}
                  {l.product ? ` · ${l.product.sku}` : ""}
                </div>
              </div>
              {open && quoted.length === 0 && (
                <form action={removeSrfqLine}>
                  <input type="hidden" name="srfq_id" value={r.id} />
                  <input type="hidden" name="line_id" value={l.id} />
                  <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Remove")}</SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
        {open && (
          <details style={{ marginTop: 12 }} open={lines.length === 0}>
            <summary>
              <strong>{tr("+ Add an item")}</strong>
            </summary>
            <form action={addSrfqLine} style={{ marginTop: 12 }}>
              <input type="hidden" name="srfq_id" value={r.id} />
              <ProductLineFields products={products} />
              <SubmitButton pendingText={tr("Adding…")}>{tr("Add item")}</SubmitButton>
            </form>
          </details>
        )}
        {lines.length > 0 && (
          <div className="actions" style={{ marginTop: 12 }}>
            <SharePdfButton href={`/supplier-rfqs/${r.id}/pdf`} fileName={`${r.number} request for quotation.pdf`} title={`Request for quotation ${r.number}`} />
            <a className="btn" href={`/supplier-rfqs/${r.id}/pdf`} target="_blank" rel="noopener">{tr("Open RFQ PDF")}</a>
          </div>
        )}
      </section>

      <section className="card" id="suppliers">
        <h2>{tr("Suppliers asked (")}{invites.length})</h2>
        {invites.length === 0 && <p className="muted small">{tr("Add the suppliers you want prices from.")}</p>}
        <ul className="list">
          {invites.map((inv) => (
            <li key={inv.id}>
              <div className="supplier-row">
                <div>
                  <strong>{inv.supplier?.name}</strong> <StatusBadge map={INVITE_STATUS} status={inv.status} />
                  <div className="muted small">
                    {inv.supplier?.country ?? ""}
                    {inv.currency !== base ? ` · ${inv.currency} @ ${n(inv.exchange_rate).toLocaleString("en-GB")}` : ""}
                  </div>
                </div>
                <div className="actions" style={{ marginTop: 0 }}>
                  {open && (
                    <Link href={`/supplier-rfqs/${r.id}/quote/${inv.id}`} className="btn btn-small btn-primary">
                      {inv.status === "quoted" ? tr("Edit prices") : tr("Enter prices")}
                    </Link>
                  )}
                  {lines.length > 0 && (
                    <SharePdfButton
                      href={`/supplier-rfqs/${r.id}/pdf?s=${inv.id}`}
                      fileName={`${r.number} ${inv.supplier?.name ?? ""}.pdf`.replace(/[^\w.\- ]+/g, "")}
                      title={`Request for quotation ${r.number}`}
                    />
                  )}
                  {open && inv.status !== "quoted" && (
                    <form action={setDeclined}>
                      <input type="hidden" name="srfq_id" value={r.id} />
                      <input type="hidden" name="invite_id" value={inv.id} />
                      <input type="hidden" name="declined" value={inv.status === "declined" ? "false" : "true"} />
                      <SubmitButton className="btn btn-small" pendingText="…">
                        {inv.status === "declined" ? tr("Undo declined") : tr("Declined")}
                      </SubmitButton>
                    </form>
                  )}
                  {open && inv.status !== "quoted" && (
                    <form action={removeInvite}>
                      <input type="hidden" name="srfq_id" value={r.id} />
                      <input type="hidden" name="invite_id" value={inv.id} />
                      <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Remove")}</SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
        {open && (
          <form action={inviteSupplier} className="inline-form" style={{ marginTop: 12 }}>
            <input type="hidden" name="srfq_id" value={r.id} />
            <select name="supplier_id" defaultValue="" required aria-label={tr("Supplier")} style={{ flex: 1 }}>
              <option value="" disabled>{tr("Choose a supplier to ask")}</option>
              {suppliers
                .filter((s) => !invitedIds.has(s.id))
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code})
                  </option>
                ))}
            </select>
            <SubmitButton className="btn btn-small" pendingText={tr("Adding…")}>{tr("Add supplier")}</SubmitButton>
          </form>
        )}
        {open && suppliers.length === 0 && (
          <p className="small">{tr("No suppliers yet.")}{" "}<Link href="/suppliers/new">{tr("+ New supplier")}</Link>
          </p>
        )}
      </section>

      {quoted.length > 0 && lines.length > 0 && (
        <section className="card" id="compare">
          <h2>{tr("Compare prices")}</h2>
          <p className="muted small">{tr("Unit prices converted to")}{" "}{base}{tr(". Green = cheapest. Totals include freight; a supplier that didn't price every item shows how many it priced.")}</p>
          <div className="scroll-x">
            <table className="compare">
              <thead>
                <tr>
                  <th>{tr("Item")}</th>
                  {summary.map((s) => (
                    <th key={s.inv.id}>{s.inv.supplier?.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {l.line_no}. {l.description}
                      <div className="muted small">
                        {n(l.quantity).toLocaleString("en-GB")} {l.unit}
                      </div>
                    </td>
                    {summary.map((s) => {
                      const p = price.get(`${s.inv.id}:${l.id}`);
                      if (p === null || p === undefined) return <td key={s.inv.id} className="none">{tr("not quoted")}</td>;
                      const b = p * n(s.inv.exchange_rate);
                      const best = quoted.length > 1 && Math.abs(b - (bestPerLine.get(l.id) ?? -1)) < 0.005;
                      return (
                        <td key={s.inv.id} className={best ? "best" : undefined}>
                          {formatMoney(b, base)}
                          {s.inv.currency !== base && <div className="small muted">{formatMoney(p, s.inv.currency)}</div>}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                <tr>
                  <td>{tr("Freight")}</td>
                  {summary.map((s) => (
                    <td key={s.inv.id}>{formatMoney(n(s.inv.freight) * n(s.inv.exchange_rate), base)}</td>
                  ))}
                </tr>
                <tr className="total">
                  <td>{tr("Total (excl. VAT)")}</td>
                  {summary.map((s) => (
                    <td key={s.inv.id} className={quoted.length > 1 && s.complete && s.total === bestTotal ? "best" : undefined}>
                      {formatMoney(s.total, base)}
                      {!s.complete && <div className="small muted">{s.count}{" "}{tr("of")}{" "}{lines.length}{" "}{tr("items")}</div>}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td>{tr("Lead time")}</td>
                  {summary.map((s) => (
                    <td key={s.inv.id}>{s.inv.lead_time_days != null ? `${s.inv.lead_time_days} days` : "—"}</td>
                  ))}
                </tr>
                <tr>
                  <td>{tr("Payment")}</td>
                  {summary.map((s) => (
                    <td key={s.inv.id}>{s.inv.payment_terms ?? "—"}</td>
                  ))}
                </tr>
                <tr>
                  <td>{tr("Incoterms")}</td>
                  {summary.map((s) => (
                    <td key={s.inv.id}>{s.inv.incoterms ?? "—"}</td>
                  ))}
                </tr>
                <tr>
                  <td>{tr("Valid until")}</td>
                  {summary.map((s) => (
                    <td key={s.inv.id}>{s.inv.valid_until ? formatDate(s.inv.valid_until) : "—"}</td>
                  ))}
                </tr>
                {open && (
                  <tr>
                    <td>{tr("Choose")}</td>
                    {summary.map((s) => (
                      <td key={s.inv.id}>
                        <form action={awardSupplier}>
                          <input type="hidden" name="srfq_id" value={r.id} />
                          <input type="hidden" name="invite_id" value={s.inv.id} />
                          <SubmitButton className="btn btn-small btn-primary" pendingText={tr("Creating PO…")}>{tr("Award & create PO")}</SubmitButton>
                        </form>
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {open && (
        <details className="card">
          <summary>
            <strong>{tr("Edit details")}</strong>
          </summary>
          <form action={saveSrfqHeader} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={r.id} />
            <div className="field">
              <label htmlFor="title">{tr("Title")}</label>
              <input id="title" name="title" type="text" defaultValue={r.title ?? ""} />
            </div>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="due_on">{tr("Reply by")}</label>
                <input id="due_on" name="due_on" type="date" defaultValue={r.due_on ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="delivery_location">{tr("Delivery to")}</label>
                <input id="delivery_location" name="delivery_location" type="text" defaultValue={r.delivery_location ?? ""} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="notes">{tr("Notes for suppliers")}</label>
              <textarea id="notes" name="notes" defaultValue={r.notes ?? ""} placeholder={tr("Printed on the RFQ PDF")} />
            </div>
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}

      {open && (
        <form action={cancelSrfq}>
          <input type="hidden" name="id" value={r.id} />
          <SubmitButton className="btn btn-block btn-danger" pendingText={tr("Cancelling…")}>{tr("Cancel this supplier RFQ")}</SubmitButton>
        </form>
      )}
    </>
  );
}
