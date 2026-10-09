import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { ProductLineFields } from "@/components/ProductPicker";
import { SharePdfButton } from "@/components/SharePdfButton";
import { SubmitButton } from "@/components/SubmitButton";
import { QuoteFollowUpCard } from "@/components/FollowUpCards";
import { getAppContext, stage13Ready } from "@/lib/context";
import { formatDate, formatDateTime } from "@/lib/format";
import { CURRENCIES, INCOTERMS, PAYMENT_TERMS } from "@/lib/lists";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { productOptions } from "@/lib/options";
import { PO_STATUS, SRFQ_STATUS } from "@/lib/purchasing";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { QUOTE_STATUS, quoteNo, StatusBadge, todayTz } from "@/lib/sales";
import {
  addQuoteLine,
  cancelQuote,
  markSent,
  recordOutcome,
  removeQuoteLine,
  reviewQuote,
  reviseQuote,
  saveQuoteHeader,
  submitQuote,
  updateQuoteLine,
} from "../actions";
import { createSupplierRfq } from "../../supplier-rfqs/actions";
import { newDelivery } from "../../deliveries/actions";
import { DELIVERY_STATUS } from "@/lib/stock";
import { OrderCosts, type OrderCost } from "@/components/OrderCosts";
import { INVOICE_STATUS, shownStatus } from "@/lib/finance";
import { newInvoice } from "../../invoices/actions";
import { applyContractPrices } from "../../contracts/actions";
import { OrderProgress } from "@/components/OrderProgress";

export const metadata = { title: "Quotation" };

type Line = {
  id: string;
  line_no: number;
  product_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_pct: number;
  line_total: number;
  product: { sku: string } | null;
};

const n = (v: unknown) => Number(v ?? 0);
const fmtNum = (v: unknown) => n(v).toLocaleString("en-GB", { maximumFractionDigits: 3 });

export default async function QuotationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: SearchParams;
}) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user, profile, features } = await getAppContext();
  const lang = await primeLang();

  const { data: q } = await supabase
    .from("quotations")
    .select("*, client:clients(id, name, code, tax_status)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!q) notFound();

  const showCosts = can(role, "seeCosts");
  const canEdit = can(role, "editSales");
  const isDraft = q.status === "draft";
  const editable = canEdit && isDraft;

  const [{ data: lineData }, { data: revData }, { data: marginRow }] = await Promise.all([
    supabase
      .from("quotation_lines")
      .select("id, line_no, product_id, description, quantity, unit, unit_price, discount_pct, line_total, product:products(sku)")
      .eq("quotation_id", id)
      .order("line_no"),
    supabase
      .from("quotations")
      .select("id, number, revision, status")
      .eq("company_id", company.id)
      .eq("number", q.number)
      .order("revision"),
    showCosts
      ? supabase.from("quotation_margins").select("*").eq("quotation_id", id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const lines = (lineData ?? []) as unknown as Line[];
  const revisions = (revData ?? []) as { id: string; number: string; revision: number; status: string }[];

  // Live margin estimate for drafts (cost roles only).
  let estimate: { margin: number | null; missing: number } | null = null;
  if (showCosts && isDraft && lines.length) {
    const ids = lines.map((l) => l.product_id).filter((x): x is string => !!x);
    const { data: costs } = ids.length
      ? await supabase.from("product_costs").select("product_id, last_cost").in("product_id", ids)
      : { data: [] };
    const costMap = new Map(((costs ?? []) as { product_id: string; last_cost: number | null }[]).map((c) => [c.product_id, c.last_cost]));
    let rev = 0;
    let cost = 0;
    let missing = 0;
    for (const l of lines) {
      const c = l.product_id ? costMap.get(l.product_id) : null;
      if (c === null || c === undefined) missing++;
      else {
        rev += n(l.line_total) * n(q.exchange_rate);
        cost += n(l.quantity) * n(c);
      }
    }
    estimate = { margin: rev > 0 ? ((rev - cost) / rev) * 100 : null, missing };
  }

  const products = editable ? await productOptions(supabase, company.id) : [];
  // Contract prices for this client (Stage 14): offered on drafts whose lines differ from them.
  let contractLines = 0;
  if (editable && features.on("contracts") && lines.length) {
    const { data: cp, error: cpError } = await supabase.rpc("client_contract_prices", { p_client: q.client_id, p_currency: q.currency });
    if (!cpError && Array.isArray(cp)) {
      const priceOf = new Map((cp as { product_id: string; unit_price: number }[]).map((c) => [c.product_id, n(c.unit_price)]));
      contractLines = lines.filter((l) => l.product_id && priceOf.has(l.product_id) && (priceOf.get(l.product_id) !== n(l.unit_price) || n(l.discount_pct) !== 0)).length;
    }
  }
  const buyer = can(role, "editPurchasing");
  const [{ data: srfqData }, { data: poData }] = buyer
    ? await Promise.all([
        supabase.from("supplier_rfqs").select("id, number, status").eq("quotation_id", id),
        supabase.from("purchase_orders").select("id, number, status, supplier:suppliers(name)").eq("quotation_id", id),
      ])
    : [{ data: [] }, { data: [] }];
  const linkedSrfqs = (srfqData ?? []) as { id: string; number: string; status: string }[];
  const linkedPos = (poData ?? []) as unknown as { id: string; number: string; status: string; supplier: { name: string } | null }[];
  const showDeliveries = q.status === "accepted" && can(role, "seeDeliveries");
  const { data: dnData } = showDeliveries
    ? await supabase.from("deliveries").select("id, number, status").eq("quotation_id", id).order("created_at")
    : { data: [] };
  const linkedDns = (dnData ?? []) as { id: string; number: string; status: string }[];
  const showInvoices = q.status === "accepted" && can(role, "seeInvoices");
  const showOrderCosts = q.status === "accepted" && (can(role, "seeProfit") || can(role, "editOrderCosts"));
  const [{ data: invData }, { data: profitData }, { data: ocData }] = await Promise.all([
    showInvoices
      ? supabase.from("invoices").select("id, number, status, total, amount_paid, currency, due_date").eq("quotation_id", id).order("created_at")
      : Promise.resolve({ data: [] }),
    showOrderCosts && can(role, "seeProfit")
      ? supabase.from("invoice_profit").select("revenue_base, cost_base, lines_without_cost").eq("quotation_id", id)
      : Promise.resolve({ data: [] }),
    showOrderCosts
      ? supabase.from("order_costs").select("id, kind, description, amount, currency, exchange_rate, incurred_on").eq("quotation_id", id).order("incurred_on")
      : Promise.resolve({ data: [] }),
  ]);
  const linkedInvoices = (invData ?? []) as { id: string; number: string; status: string; total: number; amount_paid: number; currency: string; due_date: string | null }[];
  const liveInvoices = linkedInvoices.filter((i) => i.status !== "cancelled");
  const progress = [
    { label: "Quoted", done: true },
    { label: "Approved", done: ["approved", "sent", "accepted"].includes(q.status) },
    { label: "Sent", done: ["sent", "accepted"].includes(q.status) },
    { label: "Won", done: q.status === "accepted" },
    { label: "Delivered", done: linkedDns.some((d) => d.status === "delivered") },
    { label: "Invoiced", done: liveInvoices.some((i) => i.status !== "draft") },
    { label: "Paid", done: liveInvoices.length > 0 && liveInvoices.every((i) => i.status === "paid") },
  ];
  const orderProfit = ((profitData ?? []) as { revenue_base: number; cost_base: number; lines_without_cost: number }[]).reduce(
    (a, r) => ({ rev: a.rev + n(r.revenue_base), cost: a.cost + n(r.cost_base), missing: a.missing + n(r.lines_without_cost) }),
    { rev: 0, cost: 0, missing: 0 },
  );
  const orderCosts = (ocData ?? []) as OrderCost[];
  const orderExtras = orderCosts.reduce((a, c) => a + n(c.amount) * n(c.exchange_rate), 0);
  const names = await namesFor(supabase, [q.created_by, q.submitted_by, q.approved_by]);
  const ccy = q.currency as string;
  const today = todayTz();
  const expired = q.valid_until && q.valid_until < today && ["approved", "sent"].includes(q.status);
  const pdfHref = `/quotations/${q.id}/pdf`;
  const pdfName = `${quoteNo(q)} ${q.client?.name ?? ""}.pdf`.replace(/[^\w.\- ]+/g, "").trim();
  const minMargin = n(company.quote_min_margin_pct ?? 12);

  return (
    <>
      <p className="small">
        <Link href="/quotations">{tr("← Quotations")}</Link>
        {q.rfq_id && (
          <>
            {" · "}
            <Link href={`/rfqs/${q.rfq_id}`}>{tr("RFQ")}</Link>
          </>
        )}
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{q.client?.name}</h1>
        <StatusBadge map={QUOTE_STATUS} status={q.status} />
        <div className="head-amount num">{formatMoney(q.total, ccy)}</div>
      </div>
      <p className="muted small">
        {quoteNo(q)}{" "}{tr("· issued")}{" "}{formatDate(q.issue_date)}
        {q.valid_until && <>{" "}{tr("· valid until")}{" "}{formatDate(q.valid_until)}</>}
        {expired && <span className="text-warn">{" "}{tr("· expired")}</span>}
        {q.created_by && <>{" "}{tr("· by")}{" "}{names.get(q.created_by)}</>}
      </p>
      <Notice {...notice} />
      {!["rejected", "cancelled", "superseded"].includes(q.status) && <OrderProgress steps={progress} />}

      {isDraft && q.review_note && (
        <div className="banner bad">
          <strong>{tr("Sent back by management:")}</strong> {q.review_note}
        </div>
      )}
      {q.status === "pending_approval" && (
        <div className="banner warn">
          <strong>{tr("Waiting for management approval")}</strong>{" "}{tr("because:")}{" "}{q.approval_reason}.
          {q.submitted_by && (
            <div className="small">{tr("Submitted by")}{" "}{names.get(q.submitted_by)}{" "}{tr("on")}{" "}{formatDateTime(q.submitted_at)}
            </div>
          )}
        </div>
      )}
      {["approved", "sent", "accepted"].includes(q.status) && q.approved_by && q.approval_reason && (
        <div className="banner ok small">{tr("Approved by")}{" "}{names.get(q.approved_by)}{" "}{tr("despite:")}{" "}{q.approval_reason}.{q.review_note ? ` Note: ${q.review_note}` : ""}
        </div>
      )}
      {["accepted", "rejected"].includes(q.status) && q.outcome_reason && (
        <div className={`banner ${q.status === "accepted" ? "ok" : "bad"} small`}>{tr("Client's answer:")}{" "}{q.outcome_reason}
        </div>
      )}

      {/* ---------- Actions ---------- */}
      <div className="actions-bar">
        {["approved", "sent", "accepted", "rejected"].includes(q.status) && (
          <>
            <SharePdfButton href={pdfHref} fileName={pdfName} title={`Quotation ${quoteNo(q)}`} />
            <a className="btn" href={pdfHref} target="_blank" rel="noopener">{tr("Open PDF")}</a>
          </>
        )}
        {isDraft && lines.length > 0 && (
          <a className="btn" href={pdfHref} target="_blank" rel="noopener">{tr("Preview PDF")}</a>
        )}
      </div>

      {canEdit && isDraft && lines.length > 0 && (
        <form action={submitQuote} className="card">
          <input type="hidden" name="id" value={q.id} />
          <p className="small muted" style={{ marginTop: 0 }}>{tr("When you submit, the app checks the margin and value. If they're within the rules it's approved straight away; otherwise management is asked to approve.")}</p>
          <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Checking…")}>{tr("Submit quotation")}</SubmitButton>
        </form>
      )}

      {q.status === "pending_approval" && can(role, "approveQuotes") && q.submitted_by !== user.id && (
        <form action={reviewQuote} className="card">
          <input type="hidden" name="id" value={q.id} />
          <h2>{tr("Your decision")}</h2>
          <div className="field">
            <label htmlFor="note">{tr("Note")}{" "}<span className="hint">{tr("· required when sending back")}</span>
            </label>
            <textarea id="note" name="note" placeholder={tr("e.g. OK for this client; or: reduce discount to 5%")} />
          </div>
          <div className="actions">
            <SubmitButton name="decision" value="approve" pendingText={tr("Saving…")}>{tr("Approve")}</SubmitButton>
            <SubmitButton name="decision" value="return" className="btn btn-danger" pendingText={tr("Saving…")}>{tr("Send back for changes")}</SubmitButton>
          </div>
        </form>
      )}

      {canEdit && ["approved", "sent"].includes(q.status) && (
        <section className="card">
          <h2>{tr("Client")}</h2>
          {q.status === "approved" && (
            <form action={markSent} style={{ marginBottom: 12 }}>
              <input type="hidden" name="id" value={q.id} />
              <SubmitButton className="btn btn-block">{tr("I have sent it to the client")}</SubmitButton>
            </form>
          )}
          <form action={recordOutcome}>
            <input type="hidden" name="id" value={q.id} />
            <div className="field">
              <label htmlFor="reason">{tr("Client's answer")}{" "}<span className="hint">{tr("· e.g. PO number, or why they declined")}</span>
              </label>
              <input id="reason" name="reason" type="text" />
            </div>
            <div className="actions">
              <SubmitButton name="outcome" value="accepted" pendingText={tr("Saving…")}>{tr("Client accepted")}</SubmitButton>
              <SubmitButton name="outcome" value="rejected" className="btn btn-danger" pendingText={tr("Saving…")}>{tr("Client rejected")}</SubmitButton>
            </div>
          </form>
        </section>
      )}

      {stage13Ready(company) && features.on("reminders") && can(role, "followUpQuotes") && ["approved", "sent"].includes(q.status) && (
        <QuoteFollowUpCard
          supabase={supabase}
          company={company}
          profile={profile}
          canLog
          lang={lang}
          q={{
            id: q.id,
            number: quoteNo(q),
            client_id: q.client_id,
            client_name: q.client?.name ?? "",
            contact_name: q.contact_name,
            currency: ccy,
            total: n(q.total),
            issue_date: q.issue_date,
            valid_until: q.valid_until,
            client_ref: q.client_ref ?? null,
          }}
        />
      )}

      {buyer && ["approved", "sent", "accepted"].includes(q.status) && (
        <section className="card" id="purchasing">
          <h2>{tr("Purchasing for this order")}</h2>
          {linkedSrfqs.length + linkedPos.length === 0 && (
            <p className="muted small">
              {q.status === "accepted" ? tr("The client accepted. Ask suppliers for prices, or order directly.") : tr("You can ask suppliers for prices already.")}
            </p>
          )}
          <ul className="list">
            {linkedSrfqs.map((r) => (
              <li key={r.id} className="row">
                <Link href={`/supplier-rfqs/${r.id}`}>{tr("Supplier RFQ")}{" "}{r.number}</Link>
                <StatusBadge map={SRFQ_STATUS} status={r.status} />
              </li>
            ))}
            {linkedPos.map((p) => (
              <li key={p.id} className="row">
                <Link href={`/purchase-orders/${p.id}`}>
                  {p.number} · {p.supplier?.name}
                </Link>
                <StatusBadge map={PO_STATUS} status={p.status} />
              </li>
            ))}
          </ul>
          <div className="actions">
            <form action={createSupplierRfq}>
              <input type="hidden" name="quotation_id" value={q.id} />
              <SubmitButton className="btn btn-primary" pendingText={tr("Creating…")}>{tr("Request supplier quotes")}</SubmitButton>
            </form>
            <Link href={`/purchase-orders/new?quotation=${q.id}`} className="btn">{tr("Create purchase order")}</Link>
          </div>
        </section>
      )}

      {showDeliveries && (
        <section className="card" id="deliveries">
          <h2>{tr("Deliveries to the client")}</h2>
          {linkedDns.length === 0 && <p className="muted small">{tr("No delivery notes yet.")}</p>}
          <ul className="list">
            {linkedDns.map((d) => (
              <li key={d.id} className="row">
                <Link href={`/deliveries/${d.id}`}>{d.number}</Link>
                <StatusBadge map={DELIVERY_STATUS} status={d.status} />
              </li>
            ))}
          </ul>
          {can(role, "editDeliveries") && (
            <form action={newDelivery} className="actions">
              <input type="hidden" name="quotation_id" value={q.id} />
              <SubmitButton className="btn btn-primary" pendingText={tr("Creating…")}>{tr("Create delivery note")}</SubmitButton>
            </form>
          )}
        </section>
      )}

      {showInvoices && (
        <section className="card" id="invoices">
          <h2>{tr("Invoices")}</h2>
          {linkedInvoices.length === 0 && <p className="muted small">{tr("Not invoiced yet.")}</p>}
          <ul className="list">
            {linkedInvoices.map((i) => (
              <li key={i.id} className="row">
                <Link href={`/invoices/${i.id}`}>{i.number || tr("Draft invoice")}</Link>
                <span className="small">
                  {formatMoney(i.total, i.currency)} <StatusBadge map={INVOICE_STATUS} status={shownStatus(i.status, i.due_date)} />
                </span>
              </li>
            ))}
          </ul>
          {can(role, "editInvoices") && (
            <form action={newInvoice} className="actions">
              <input type="hidden" name="quotation_id" value={q.id} />
              <input type="hidden" name="back" value={`/quotations/${q.id}#invoices`} />
              <SubmitButton className="btn btn-primary" pendingText={tr("Creating…")}>
                {linkedInvoices.some((i) => i.status !== "cancelled") ? tr("Invoice the rest") : tr("Create invoice")}
              </SubmitButton>
            </form>
          )}
          <p className="hint">{tr("Usually you invoice each delivery from its delivery note. Use this for advance or whole-order invoices.")}</p>
        </section>
      )}

      {showOrderCosts && (
        <section className="card" id="profit">
          <h2>{tr("Order costs")}{can(role, "seeProfit") ? tr(" & profit") : ""}</h2>
          {can(role, "seeProfit") && (
            <dl className="kv">
              <dt>{tr("Invoiced (before VAT)")}</dt>
              <dd>{formatMoney(orderProfit.rev, company.base_currency)}</dd>
              <dt>{tr("Cost of goods")}</dt>
              <dd>{formatMoney(orderProfit.cost, company.base_currency)}</dd>
              <dt>{tr("Other order costs")}</dt>
              <dd>{formatMoney(orderExtras, company.base_currency)}</dd>
              <dt>{tr("Gross profit")}</dt>
              <dd>
                <strong>{formatMoney(orderProfit.rev - orderProfit.cost - orderExtras, company.base_currency)}</strong>
                {orderProfit.rev > 0 && (
                  <span className="muted">
                    {" "}
                    ({(((orderProfit.rev - orderProfit.cost - orderExtras) / orderProfit.rev) * 100).toFixed(1)}%)
                  </span>
                )}
              </dd>
              {orderProfit.missing > 0 && (
                <>
                  <dt>{tr("Lines without a cost")}</dt>
                  <dd className="text-warn">{orderProfit.missing}</dd>
                </>
              )}
            </dl>
          )}
          <p className="muted small">{tr("Costs of this order that are not part of the goods: local transport, bank charges, commission…")}</p>
          <OrderCosts
            costs={orderCosts}
            back={`/quotations/${q.id}#profit`}
            quotationId={q.id}
            base={company.base_currency}
            canEdit={can(role, "editOrderCosts")}
          />
        </section>
      )}

      {/* ---------- Lines ---------- */}
      <section className="card" id="lines">
        <h2>{tr("Items (")}{lines.length})</h2>
        {lines.length === 0 && <p className="muted small">{tr("No items yet.")}</p>}
        <ul className="lines">
          {lines.map((l) => (
            <li key={l.id}>
              <div className="line-head">
                <div>
                  <div className="desc">
                    {l.line_no}. {l.description}
                  </div>
                  <div className="muted small">
                    {fmtNum(l.quantity)} {l.unit} × {formatMoney(l.unit_price, ccy)}
                    {n(l.discount_pct) > 0 && ` − ${n(l.discount_pct)}%`}
                    {l.product ? ` · ${l.product.sku}` : ""}
                  </div>
                </div>
                <strong style={{ whiteSpace: "nowrap" }}>{formatMoney(l.line_total, ccy)}</strong>
              </div>
              {editable && (
                <div className="row" style={{ alignItems: "end" }}>
                  <form action={updateQuoteLine} className="line-edit" style={{ flex: 1 }}>
                    <input type="hidden" name="quotation_id" value={q.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <div>
                      <label htmlFor={`q-${l.id}`}>{tr("Qty")}</label>
                      <input id={`q-${l.id}`} name="quantity" type="text" inputMode="decimal" defaultValue={fmtNum(l.quantity)} />
                    </div>
                    <div>
                      <label htmlFor={`p-${l.id}`}>{tr("Unit price")}</label>
                      <input id={`p-${l.id}`} name="unit_price" type="text" inputMode="decimal" defaultValue={fmtNum(l.unit_price)} />
                    </div>
                    <div>
                      <label htmlFor={`d-${l.id}`}>{tr("Disc. %")}</label>
                      <input id={`d-${l.id}`} name="discount_pct" type="text" inputMode="decimal" defaultValue={fmtNum(l.discount_pct)} />
                    </div>
                    <SubmitButton className="btn btn-small" pendingText="…">{tr("Update")}</SubmitButton>
                  </form>
                  <form action={removeQuoteLine}>
                    <input type="hidden" name="quotation_id" value={q.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Remove")}</SubmitButton>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>

        <div className="totals" style={{ marginTop: 12 }}>
          {n(q.discount_total) > 0 && (
            <div className="row small muted">
              <span>{tr("Discounts")}</span>
              <span>− {formatMoney(q.discount_total, ccy)}</span>
            </div>
          )}
          <div className="row">
            <span>{tr("Subtotal")}</span>
            <span>{formatMoney(q.subtotal, ccy)}</span>
          </div>
          <div className="row">
            <span>{tr("VAT")}{" "}{n(q.vat_rate)}%</span>
            <span>{formatMoney(q.vat_amount, ccy)}</span>
          </div>
          <div className="row grand">
            <span>{tr("Total")}</span>
            <span>{formatMoney(q.total, ccy)}</span>
          </div>
          {ccy !== company.base_currency && (
            <div className="row small muted">
              <span>{tr("≈ in")}{" "}{company.base_currency}{" "}{tr("at")}{" "}{fmtNum(q.exchange_rate)}
              </span>
              <span>{formatMoney(n(q.total) * n(q.exchange_rate), company.base_currency)}</span>
            </div>
          )}
        </div>

        {contractLines > 0 && (
          <form action={applyContractPrices} className="banner small" style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="quotation_id" value={q.id} />
            <span style={{ flex: 1 }}>
              {contractLines} {tr("line(s) have an agreed contract price for this client.")}
            </span>
            <SubmitButton className="btn btn-small btn-primary" pendingText="…">
              {tr("Use contract prices")}
            </SubmitButton>
          </form>
        )}
        {editable && (
          <details style={{ marginTop: 16 }} open={lines.length === 0}>
            <summary>
              <strong>{tr("+ Add an item")}</strong>
            </summary>
            <form action={addQuoteLine} style={{ marginTop: 12 }}>
              <input type="hidden" name="quotation_id" value={q.id} />
              <ProductLineFields products={products} showPrice />
              {ccy !== company.base_currency && (
                <p className="hint">{tr("Catalogue prices are converted from")}{" "}{company.base_currency}{" "}{tr("at the rate on this quotation (")}{fmtNum(q.exchange_rate)}{tr("). Set the rate under Details first.")}</p>
              )}
              <SubmitButton pendingText={tr("Adding…")}>{tr("Add item")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      {showCosts && (estimate || marginRow) && (
        <section className="card">
          <h2>{tr("Margin")}</h2>
          <p className="muted small">{tr("Only management, procurement and finance can see this.")}</p>
          {(() => {
            const m = estimate ? estimate.margin : marginRow?.margin_pct != null ? n(marginRow.margin_pct) : null;
            const missing = estimate ? estimate.missing : n(marginRow?.lines_without_cost);
            return (
              <dl className="kv">
                <dt>{estimate ? tr("Estimated margin") : tr("Margin at submission")}</dt>
                <dd className={m !== null && m < minMargin ? "text-warn" : undefined}>
                  {m === null ? "—" : `${m.toFixed(1)}%`}
                </dd>
                {missing > 0 && (
                  <>
                    <dt>{tr("Lines without a cost")}</dt>
                    <dd className="text-warn">{missing}</dd>
                  </>
                )}
                {!estimate && marginRow && (
                  <>
                    <dt>{tr("Cost (known lines)")}</dt>
                    <dd>{formatMoney(marginRow.cost_base, company.base_currency)}</dd>
                  </>
                )}
              </dl>
            );
          })()}
        </section>
      )}

      {/* ---------- Details ---------- */}
      <section className="card" id="details">
        <h2>{tr("Details")}</h2>
        <form action={saveQuoteHeader}>
          <input type="hidden" name="id" value={q.id} />
          <fieldset className="plain" disabled={!editable}>
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="contact_name">{tr("Attention (client contact)")}</label>
                <input id="contact_name" name="contact_name" type="text" defaultValue={q.contact_name ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="client_ref">{tr("Client's reference")}</label>
                <input id="client_ref" name="client_ref" type="text" defaultValue={q.client_ref ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="currency">{tr("Currency")}</label>
                <select id="currency" name="currency" defaultValue={ccy}>
                  {CURRENCIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="exchange_rate">{tr("Exchange rate")}{" "}<span className="hint">· {company.base_currency}{" "}{tr("per 1 unit")}</span>
                </label>
                <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={fmtNum(q.exchange_rate)} />
              </div>
              <div className="field">
                <label htmlFor="issue_date">{tr("Issue date")}</label>
                <input id="issue_date" name="issue_date" type="date" defaultValue={q.issue_date} />
              </div>
              <div className="field">
                <label htmlFor="valid_until">{tr("Valid until")}</label>
                <input id="valid_until" name="valid_until" type="date" defaultValue={q.valid_until ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="delivery_time">{tr("Delivery time")}</label>
                <input id="delivery_time" name="delivery_time" type="text" defaultValue={q.delivery_time ?? ""} placeholder={tr("e.g. 2–3 weeks after PO")} />
              </div>
              <div className="field">
                <label htmlFor="payment_terms">{tr("Payment terms")}</label>
                <select id="payment_terms" name="payment_terms" defaultValue={q.payment_terms ?? ""}>
                  <option value="">—</option>
                  {[...new Set([...(q.payment_terms ? [q.payment_terms] : []), ...PAYMENT_TERMS])].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="incoterms">{tr("Incoterms")}</label>
                <select id="incoterms" name="incoterms" defaultValue={q.incoterms ?? ""}>
                  <option value="">—</option>
                  {INCOTERMS.map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="vat_rate">{tr("VAT %")}</label>
                <input id="vat_rate" name="vat_rate" type="text" inputMode="decimal" defaultValue={fmtNum(q.vat_rate)} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="notes">{tr("Notes to the client")}{" "}<span className="hint">{tr("· printed on the quotation")}</span>
                </label>
                <textarea id="notes" name="notes" defaultValue={q.notes ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="terms">{tr("Terms and conditions")}</label>
                <textarea id="terms" name="terms" defaultValue={q.terms ?? ""} />
              </div>
            </div>
            {editable && <SubmitButton>{tr("Save details")}</SubmitButton>}
          </fieldset>
        </form>
      </section>

      {revisions.length > 1 && (
        <section className="card">
          <h2>{tr("Versions")}</h2>
          <ul className="list">
            {revisions.map((r) => (
              <li key={r.id} className="row">
                {r.id === q.id ? <strong>{quoteNo(r)}{" "}{tr("(this one)")}</strong> : <Link href={`/quotations/${r.id}`}>{quoteNo(r)}</Link>}
                <StatusBadge map={QUOTE_STATUS} status={r.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {canEdit && (
        <div className="actions">
          {["pending_approval", "approved", "sent", "rejected"].includes(q.status) && (
            <form action={reviseQuote}>
              <input type="hidden" name="id" value={q.id} />
              <SubmitButton className="btn" pendingText={tr("Copying…")}>{tr("Make a revision")}</SubmitButton>
            </form>
          )}
          {!["accepted", "superseded", "cancelled"].includes(q.status) && (
            <form action={cancelQuote}>
              <input type="hidden" name="id" value={q.id} />
              <SubmitButton className="btn btn-danger" pendingText={tr("Cancelling…")}>{tr("Cancel quotation")}</SubmitButton>
            </form>
          )}
        </div>
      )}
    </>
  );
}
