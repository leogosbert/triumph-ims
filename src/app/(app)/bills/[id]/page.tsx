import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { BILL_STATUS, daysOverdue, isOpen, n, PAY_METHODS, shownStatus } from "@/lib/finance";
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
  reference: string | null;
  voided_at: string | null;
  void_reason: string | null;
};

export default async function BillPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
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
    .select("id, number, paid_on, amount, currency, exchange_rate, method, reference, voided_at, void_reason")
    .eq("bill_id", id)
    .order("paid_on");
  const pays = (payData ?? []) as Pay[];

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
        <Link href="/bills">← Supplier bills</Link>
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
      </div>
      <p className="muted small">
        {b.number}
        {b.supplier_invoice_no && <> · their invoice {b.supplier_invoice_no}</>} · dated {formatDate(b.bill_date)}
        {b.due_date && <> · due {formatDate(b.due_date)}</>}
        {late > 0 && <span className="text-warn"> · {late} days overdue</span>}
      </p>
      <Notice {...notice} />

      <section className="card" id="payments">
        <h2>Payment</h2>
        <div className="totals" style={{ maxWidth: "none" }}>
          <div className="row">
            <span>Bill total</span>
            <span>{formatMoney(b.total, ccy)}</span>
          </div>
          <div className="row small muted">
            <span>of which VAT</span>
            <span>{formatMoney(b.vat_amount, ccy)}</span>
          </div>
          <div className="row">
            <span>Paid</span>
            <span>{formatMoney(b.amount_paid, ccy)}</span>
          </div>
          <div className={`row grand ${late > 0 ? "text-warn" : ""}`}>
            <span>Still to pay</span>
            <span>{formatMoney(b.status === "cancelled" ? 0 : balance, ccy)}</span>
          </div>
          {ccy !== company.base_currency && (
            <div className="row small muted">
              <span>
                ≈ in {company.base_currency} at {fmtNum(b.exchange_rate)}
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
                    {formatDate(p.paid_on)} · {PAY_METHODS[p.method] ?? p.method}
                    {p.reference ? ` · ${p.reference}` : ""} · {p.number}
                    {p.currency !== company.base_currency && ` · rate ${fmtNum(p.exchange_rate)}`}
                  </span>
                </div>
                {p.voided_at && <div className="small text-warn">Voided: {p.void_reason}</div>}
                {!p.voided_at && can(role, "voidPayments") && (
                  <details className="small">
                    <summary>Void this payment</summary>
                    <form action={voidSupplierPayment} className="inline-form" style={{ marginTop: 6 }}>
                      <input type="hidden" name="bill_id" value={b.id} />
                      <input type="hidden" name="payment_id" value={p.id} />
                      <input name="reason" type="text" placeholder="Reason" required />
                      <SubmitButton className="btn btn-small btn-danger" pendingText="…">
                        Void
                      </SubmitButton>
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
              <strong>+ Record a payment to the supplier</strong>
            </summary>
            <form action={payBill} style={{ marginTop: 12 }}>
              <input type="hidden" name="bill_id" value={b.id} />
              <div className="grid grid-2">
                <div className="field">
                  <label htmlFor="amount">Amount ({ccy})</label>
                  <input id="amount" name="amount" type="text" inputMode="decimal" defaultValue={fmtNum(balance)} required />
                </div>
                <div className="field">
                  <label htmlFor="paid_on">Date paid</label>
                  <input id="paid_on" name="paid_on" type="date" defaultValue={todayTz()} />
                </div>
                <div className="field">
                  <label htmlFor="method">How</label>
                  <select id="method" name="method" defaultValue="bank_transfer">
                    {Object.entries(PAY_METHODS).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="reference">Reference</label>
                  <input id="reference" name="reference" type="text" placeholder="TT / transfer ref" />
                </div>
                {ccy !== company.base_currency && (
                  <div className="field">
                    <label htmlFor="exchange_rate">
                      Bank rate used <span className="hint">· {company.base_currency} per 1 {ccy}</span>
                    </label>
                    <input id="exchange_rate" name="exchange_rate" type="text" inputMode="decimal" defaultValue={fmtNum(b.exchange_rate)} />
                  </div>
                )}
              </div>
              <SubmitButton pendingText="Saving…">Record payment</SubmitButton>
            </form>
          </details>
        )}
      </section>

      <section className="card" id="details">
        <h2>Details</h2>
        {!editable && b.status !== "cancelled" && n(b.amount_paid) > 0 && (
          <p className="small muted">This bill has payments, so it can no longer be changed.</p>
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
            {editable && <SubmitButton>Save</SubmitButton>}
          </fieldset>
        </form>
      </section>

      {editable && (
        <form action={cancelBill} className="actions">
          <input type="hidden" name="id" value={b.id} />
          <SubmitButton className="btn btn-danger" pendingText="Cancelling…">
            Cancel this bill
          </SubmitButton>
        </form>
      )}
    </>
  );
}
