import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { ProductLineFields } from "@/components/ProductPicker";
import { RfqHeaderFields } from "@/components/RfqHeaderFields";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { clientOptions, productOptions } from "@/lib/options";
import { companyPeople, namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { QUOTE_STATUS, quoteNo, RECEIVED_VIA, RFQ_STATUS, StatusBadge } from "@/lib/sales";
import { addRfqLine, cancelRfq, quoteFromRfq, removeRfqLine, saveRfq } from "../actions";
import { createSupplierRfq } from "../../supplier-rfqs/actions";

export const metadata = { title: "RFQ" };

type Line = { id: string; line_no: number; description: string; quantity: number; unit: string; notes: string | null; product: { sku: string } | null };
type Quote = { id: string; number: string; revision: number; status: string; total: number; currency: string };

export default async function RfqPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();

  const { data: rfq } = await supabase
    .from("rfqs")
    .select("*, client:clients(id, name, code)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!rfq) notFound();

  const [{ data: lineData }, { data: quoteData }] = await Promise.all([
    supabase.from("rfq_lines").select("id, line_no, description, quantity, unit, notes, product:products(sku)").eq("rfq_id", id).order("line_no"),
    supabase.from("quotations").select("id, number, revision, status, total, currency").eq("rfq_id", id).order("created_at"),
  ]);
  const lines = (lineData ?? []) as unknown as Line[];
  const quotes = (quoteData ?? []) as Quote[];
  const editable = can(role, "editSales") && ["new", "quoting", "quoted"].includes(rfq.status);
  const linesEditable = can(role, "editSales") && ["new", "quoting"].includes(rfq.status);
  const [clients, people, products, names] = await Promise.all([
    editable ? clientOptions(supabase, company.id) : Promise.resolve([]),
    editable ? companyPeople(supabase, company.id) : Promise.resolve([]),
    linesEditable ? productOptions(supabase, company.id) : Promise.resolve([]),
    namesFor(supabase, [rfq.assigned_to, rfq.created_by]),
  ]);

  return (
    <>
      <p className="small">
        <Link href="/rfqs">{tr("← RFQs")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{rfq.client?.name}</h1>
        <StatusBadge map={RFQ_STATUS} status={rfq.status} />
      </div>
      <p className="muted small">
        {rfq.number}{" "}{tr("· received")}{" "}{formatDate(rfq.received_on)}{" "}{tr("by")}{" "}
        {RECEIVED_VIA.find((r) => r.value === rfq.received_via)?.label.toLowerCase()}
        {rfq.due_on && <>{" "}{tr("· due")}{" "}{formatDate(rfq.due_on)}</>}
        {rfq.assigned_to && <> · {names.get(rfq.assigned_to)}</>}
      </p>
      {rfq.title && <p><strong>{tr(String(rfq.title ?? ""))}</strong></p>}
      <Notice {...notice} />

      <section className="card" id="lines">
        <h2>{tr("Items requested (")}{lines.length})</h2>
        {lines.length === 0 ? (
          <p className="muted small">{tr("No items yet.")}</p>
        ) : (
          <ul className="lines">
            {lines.map((l) => (
              <li key={l.id}>
                <div className="line-head">
                  <div>
                    <div className="desc">
                      {l.line_no}. {l.description}
                    </div>
                    <div className="muted small">
                      {Number(l.quantity).toLocaleString("en-GB")} {l.unit}
                      {l.product ? ` · ${l.product.sku}` : tr(" · not in catalogue")}
                      {l.notes ? ` · ${l.notes}` : ""}
                    </div>
                  </div>
                  {linesEditable && (
                    <form action={removeRfqLine}>
                      <input type="hidden" name="rfq_id" value={rfq.id} />
                      <input type="hidden" name="line_id" value={l.id} />
                      <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Remove")}</SubmitButton>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {linesEditable && (
          <details style={{ marginTop: 12 }} open={lines.length === 0}>
            <summary className="small">
              <strong>{tr("+ Add an item")}</strong>
            </summary>
            <form action={addRfqLine} style={{ marginTop: 12 }}>
              <input type="hidden" name="rfq_id" value={rfq.id} />
              <ProductLineFields products={products} />
              <div className="field">
                <label htmlFor="notes">{tr("Notes")}</label>
                <input id="notes" name="notes" type="text" placeholder={tr("e.g. client wants SKF only")} />
              </div>
              <SubmitButton pendingText={tr("Adding…")}>{tr("Add item")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      <section className="card">
        <h2>{tr("Quotations")}</h2>
        {quotes.length === 0 ? (
          <p className="muted small">{tr("No quotation yet.")}</p>
        ) : (
          <ul className="list">
            {quotes.map((q) => (
              <li key={q.id} className="row">
                <Link href={`/quotations/${q.id}`}>{quoteNo(q)}</Link>
                <span className="small">
                  {formatMoney(q.total, q.currency)} <StatusBadge map={QUOTE_STATUS} status={q.status} />
                </span>
              </li>
            ))}
          </ul>
        )}
        {can(role, "editSales") && ["new", "quoting", "quoted"].includes(rfq.status) && lines.length > 0 && (
          <form action={quoteFromRfq} style={{ marginTop: 12 }}>
            <input type="hidden" name="rfq_id" value={rfq.id} />
            <input type="hidden" name="client_id" value={rfq.client_id} />
            <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Creating…")}>
              {quotes.length ? tr("Create another quotation") : tr("Create quotation from these items")}
            </SubmitButton>
          </form>
        )}
      </section>

      {can(role, "editPurchasing") && ["new", "quoting"].includes(rfq.status) && lines.length > 0 && (
        <form action={createSupplierRfq} className="card">
          <input type="hidden" name="rfq_id" value={rfq.id} />
          <p className="small muted" style={{ marginTop: 0 }}>{tr("Need supplier prices before quoting? Send these items to suppliers.")}</p>
          <SubmitButton className="btn btn-block" pendingText={tr("Creating…")}>{tr("Request supplier quotes")}</SubmitButton>
        </form>
      )}

      {editable && (
        <details className="card">
          <summary>
            <strong>{tr("Edit RFQ details")}</strong>
          </summary>
          <form action={saveRfq} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={rfq.id} />
            <RfqHeaderFields values={rfq} clients={clients} people={people} />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
      {rfq.notes && !editable && (
        <section className="card">
          <h2>{tr("Notes")}</h2>
          <p>{rfq.notes}</p>
        </section>
      )}

      {can(role, "editSales") && ["new", "quoting", "quoted"].includes(rfq.status) && (
        <form action={cancelRfq}>
          <input type="hidden" name="id" value={rfq.id} />
          <SubmitButton className="btn btn-block btn-danger" pendingText={tr("Cancelling…")}>{tr("Cancel this RFQ")}</SubmitButton>
        </form>
      )}
    </>
  );
}
