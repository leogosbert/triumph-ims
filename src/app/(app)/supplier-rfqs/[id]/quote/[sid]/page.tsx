import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { CURRENCIES, INCOTERMS, PAYMENT_TERMS } from "@/lib/lists";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";
import { saveSupplierQuote } from "../../../actions";

export const metadata = { title: "Supplier prices" };

type Line = { id: string; line_no: number; description: string; quantity: number; unit: string };
const fmt = (v: unknown) => (v === null || v === undefined ? "" : Number(v).toLocaleString("en-GB", { maximumFractionDigits: 6 }));

export default async function SupplierQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; sid: string }>;
  searchParams: SearchParams;
}) {
  await primeLang();
  const { id, sid } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editPurchasing")) redirect("/");

  const [{ data: r }, { data: inv }, { data: lineData }, { data: qlData }] = await Promise.all([
    supabase.from("supplier_rfqs").select("id, number, title, status").eq("id", id).eq("company_id", company.id).maybeSingle(),
    supabase.from("supplier_rfq_suppliers").select("*, supplier:suppliers(name)").eq("id", sid).eq("srfq_id", id).maybeSingle(),
    supabase.from("supplier_rfq_lines").select("id, line_no, description, quantity, unit").eq("srfq_id", id).order("line_no"),
    supabase.from("supplier_quote_lines").select("srfq_line_id, unit_price").eq("srfq_supplier_id", sid),
  ]);
  if (!r || !inv) notFound();
  if (r.status !== "open") redirect(`/supplier-rfqs/${id}`);
  const lines = (lineData ?? []) as Line[];
  const prices = new Map(((qlData ?? []) as { srfq_line_id: string; unit_price: number | null }[]).map((q) => [q.srfq_line_id, q.unit_price]));

  return (
    <>
      <p className="small">
        <Link href={`/supplier-rfqs/${id}`}>← {r.title ?? r.number}</Link>
      </p>
      <h1>{tr("Prices from")}{" "}{inv.supplier?.name}</h1>
      <p className="muted small">{tr("Type the prices exactly as the supplier quoted them, in their currency. Leave an item empty if they can't supply it.")}</p>
      <Notice {...notice} />
      <form action={saveSupplierQuote}>
        <input type="hidden" name="srfq_id" value={id} />
        <input type="hidden" name="invite_id" value={sid} />
        <section className="card">
          <h2>{tr("Their offer")}</h2>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="currency">{tr("Currency")}</label>
              <select id="currency" name="currency" defaultValue={inv.currency}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="exchange_rate">{tr("Exchange rate")}{" "}<span className="hint">· {company.base_currency}{" "}{tr("per 1 unit (ignored for")}{" "}{company.base_currency})</span>
              </label>
              <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={fmt(inv.exchange_rate)} />
            </div>
            <div className="field">
              <label htmlFor="freight">{tr("Freight / delivery charge (their currency)")}</label>
              <input id="freight" name="freight" type="text" inputMode="decimal" defaultValue={fmt(inv.freight)} />
            </div>
            <div className="field">
              <label htmlFor="lead_time_days">{tr("Lead time (days)")}</label>
              <input id="lead_time_days" name="lead_time_days" type="text" inputMode="numeric" defaultValue={fmt(inv.lead_time_days)} />
            </div>
            <div className="field">
              <label htmlFor="payment_terms">{tr("Payment terms")}</label>
              <select id="payment_terms" name="payment_terms" defaultValue={inv.payment_terms ?? ""}>
                <option value="">—</option>
                {[...new Set([...(inv.payment_terms ? [inv.payment_terms] : []), ...PAYMENT_TERMS])].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="incoterms">{tr("Incoterms")}</label>
              <select id="incoterms" name="incoterms" defaultValue={inv.incoterms ?? ""}>
                <option value="">—</option>
                {INCOTERMS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="valid_until">{tr("Offer valid until")}</label>
              <input id="valid_until" name="valid_until" type="date" defaultValue={inv.valid_until ?? ""} />
            </div>
            <div className="field">
              <label htmlFor="received_on">{tr("Received on")}</label>
              <input id="received_on" name="received_on" type="date" defaultValue={inv.received_on ?? todayTz()} />
            </div>
            <div className="field">
              <label htmlFor="supplier_ref">{tr("Their quote reference")}</label>
              <input id="supplier_ref" name="supplier_ref" type="text" defaultValue={inv.supplier_ref ?? ""} />
            </div>
            <div className="field" style={{ gridColumn: "1 / -1" }}>
              <label htmlFor="notes">{tr("Notes")}</label>
              <textarea id="notes" name="notes" defaultValue={inv.notes ?? ""} placeholder={tr("e.g. offers FAG instead of SKF; price excludes CoA")} />
            </div>
          </div>
        </section>

        <section className="card">
          <h2>{tr("Unit prices")}</h2>
          <ul className="lines">
            {lines.map((l) => (
              <li key={l.id}>
                <div className="line-head" style={{ alignItems: "center" }}>
                  <div>
                    <div className="desc">
                      {l.line_no}. {l.description}
                    </div>
                    <div className="muted small">
                      {Number(l.quantity).toLocaleString("en-GB")} {l.unit}
                    </div>
                  </div>
                  <input
                    name={`price_${l.id}`}
                    type="text"
                    inputMode="decimal"
                    aria-label={`Unit price for ${l.description}`}
                    placeholder={tr("price / unit")}
                    defaultValue={fmt(prices.get(l.id))}
                    style={{ width: 140 }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
        <SubmitButton className="btn btn-primary btn-block">{tr("Save prices")}</SubmitButton>
      </form>
    </>
  );
}
