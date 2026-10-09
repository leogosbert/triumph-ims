import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { PayMethodFields } from "@/components/PayMethodFields";
import { getAppContext, stage13Ready } from "@/lib/context";
import { BILL_STATUS, daysOverdue, isOpen, methodLabel, n, shownStatus } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import { cancelBill, payBill, saveBill, voidSupplierPayment } from "../actions";
import { BillFields } from "../BillFields";

export const metadata = { title: "Supplier bill" };

const fmtNum = (v: unknown) => n(v).toLocaleString("en-GB", { maximumFractionDigits: 6 });

type Pay = {
  id: string;
  number: string;
  paid_on: string;
  amount: number;
  currency: string;
  exchange_rate: number;
  method: string;
  provider?: string | null;
  reconciled_at?: string | null;
  reference: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

export default async function BillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeBills")) redirect("/");

  const { data: b } = await supabase
    .from("supplier_bills")
    .select("*, supplier:suppliers(id, name), po:purchase_orders(id, number)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!b) notFound();
  const { data: payData } = await supabase
    .from("supplier_payments")
    .select(`id, number, paid_on, amount, currency, exchange_rate, method, reference, voided_at, void_reason${stage13Ready(company) ? ", provider, reconciled_at" : ""}`)
    .eq("bill_id", id)
    .order("paid_on");
  const pays = (payData ?? []) as unknown as Pay[];

  const edit = can(role, "editBills");
  const open = isOpen(b.status);
  const editable = edit && b.status === "open" && n(b.amount_paid) === 0;
  const ccy = b.currency as string;
  const balance = n(b.total) - n(b.amount_paid);
  const shown = shownStatus(b.status, b.due_date);
  const late = open ? daysOverdue(b.due_date) : 0;

  return (
    <>
      <p className="small">
        <Link href="/bills">{tr("← Supplier bills")}</Link>
        {b.po && (
          <>
            {" · "}
            <Link href={`/purchase-orders/${b.po.id}`}>{b.po.number}</Link>
          </>
        )}
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{b.supplier?.name}</h1>
        <StatusBadge map={BILL_STATUS} status={shown} />
        <div className="head-amount num">
          {formatMoney(b.status === "open" || b.status === "partly_paid" ? balance : b.total, ccy)}
          {(b.status === "open" || b.status === "partly_paid") && n(b.amount_paid) > 0 && <span>{tr("Balance due")}</span>}
        </div>
      </div>
      <p className="muted small">
        {b.number}
        {b.supplier_invoice_no && <>{" "}{tr("· their invoice")}{" "}{b.supplier_invoice_no}</>}{" "}{tr("· dated")}{" "}{formatDate(b.bill_date)}
        {b.due_date && <>{" "}{tr("· due")}{" "}{formatDate(b.due_date)}</>}
        {late > 0 && <span className="text-warn"> · {late}{" "}{tr("days overdue")}</span>}
      </p>
      <Notice {...notice} />

      <section className="card" id="payments">
        <h2>{tr("Payment")}</h2>
        <div className="totals" style={{ maxWidth: "none" }}>
          <div className="row">
            <span>{tr("Bill total")}</span>
            <span>{formatMoney(b.total, ccy)}</span>
          </div>
          <div className="row small muted">
            <span>{tr("of which VAT")}</span>
            <span>{formatMoney(b.vat_amount, ccy)}</span>
          </div>
          <div className="row">
            <span>{tr("Paid")}</span>
            <span>{formatMoney(b.amount_paid, ccy)}</span>
          </div>
          <div className={`row grand ${late > 0 ? "text-warn" : ""}`}>
            <span>{tr("Still to pay")}</span>
            <span>{formatMoney(b.status === "cancelled" ? 0 : balance, ccy)}</span>
          </div>
          {ccy !== company.base_currency && (
            <div className="row small muted">
              <span>{tr("≈ in")}{" "}{company.base_currency}{" "}{tr("at")}{" "}{fmtNum(b.exchange_rate)}
              </span>
              <span>{formatMoney(balance * n(b.exchange_rate), company.base_currency)}</span>
            </div>
          )}
        </div>

        {pays.length > 0 && (
          <ul className="list" style={{ marginTop: 12 }}>
            {pays.map((p) => (
              <li key={p.id}>
                <div className="row">
                  <strong style={p.voided_at ? { textDecoration: "line-through" } : undefined}>{formatMoney(p.amount, p.currency)}</strong>
                  <span className="small muted">
                    {formatDate(p.paid_on)} · {tr(methodLabel(p.method, p.provider))}
                    {p.reference ? ` · ${p.reference}` : ""} · {p.number}
                    {p.reconciled_at && <span className="text-ok" title={tr("checked against the statement")}> ✓</span>}
                    {p.currency !== company.base_currency && ` · rate ${fmtNum(p.exchange_rate)}`}
                  </span>
                </div>
                {p.voided_at && <div className="small text-warn">{tr("Voided:")}{" "}{p.void_reason}</div>}
                {!p.voided_at && can(role, "voidPayments") && (
                  <details className="small">
                    <summary>{tr("Void this payment")}</summary>
                    <form action={voidSupplierPayment} className="inline-form" style={{ marginTop: 6 }}>
                      <input type="hidden" name="bill_id" value={b.id} />
                      <input type="hidden" name="payment_id" value={p.id} />
                      <input name="reason" type="text" placeholder={tr("Reason")} required />
                      <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Void")}</SubmitButton>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}

        {edit && open && (
          <details style={{ marginTop: 12 }} open={pays.length === 0}>
            <summary>
              <strong>{tr("+ Record a payment to the supplier")}</strong>
            </summary>
            <form action={payBill} style={{ marginTop: 12 }}>
              <input type="hidden" name="bill_id" value={b.id} />
              <div className="grid grid-2">
                <div className="field">
                  <label htmlFor="amount">{tr("Amount (")}{ccy})</label>
                  <input id="amount" name="amount" type="text" inputMode="decimal" defaultValue={fmtNum(balance)} required />
                </div>
                <div className="field">
                  <label htmlFor="paid_on">{tr("Date paid")}</label>
                  <input id="paid_on" name="paid_on" type="date" defaultValue={todayTz()} />
                </div>
                <PayMethodFields withProvider={stage13Ready(company)} />
                {ccy !== company.base_currency && (
                  <div className="field">
                    <label htmlFor="exchange_rate">{tr("Bank rate used")}{" "}<span className="hint">· {company.base_currency}{" "}{tr("per 1")}{" "}{ccy}</span>
                    </label>
                    <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={fmtNum(b.exchange_rate)} />
                  </div>
                )}
              </div>
              <SubmitButton pendingText={tr("Saving…")}>{tr("Record payment")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      <section className="card" id="details">
        <h2>{tr("Details")}</h2>
        {!editable && b.status !== "cancelled" && n(b.amount_paid) > 0 && (
          <p className="small muted">{tr("This bill has payments, so it can no longer be changed.")}</p>
        )}
        <form action={saveBill}>
          <input type="hidden" name="id" value={b.id} />
          <fieldset className="plain" disabled={!editable}>
            <BillFields
              base={company.base_currency}
              v={{
                supplier_invoice_no: b.supplier_invoice_no,
                bill_date: b.bill_date,
                due_date: b.due_date,
                currency: ccy,
                exchange_rate: n(b.exchange_rate),
                subtotal: n(b.subtotal),
                vat_amount: n(b.vat_amount),
                notes: b.notes,
              }}
            />
            {editable && <SubmitButton>{tr("Save")}</SubmitButton>}
          </fieldset>
        </form>
      </section>

      {editable && (
        <form action={cancelBill} className="actions">
          <input type="hidden" name="id" value={b.id} />
          <SubmitButton className="btn btn-danger" pendingText={tr("Cancelling…")}>{tr("Cancel this bill")}</SubmitButton>
        </form>
      )}
    </>
  );
}
