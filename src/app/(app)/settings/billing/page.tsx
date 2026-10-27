import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import {
  ACCOUNT_STATUS,
  BILLING_MISSING,
  CYCLE_LABEL,
  estimateMonthly,
  INVOICE_STATUS,
  loadBillingSettings,
  loadPriceBook,
  overdue,
  planFor,
  sum,
  type CompanyBilling,
  type PlatformInvoice,
} from "@/lib/billing";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can, hasRole } from "@/lib/roles";
import { SettingsHead } from "../SettingsHead";
import { saveBillingDetails } from "./actions";

export const metadata = { title: "Plan & billing" };

/** The company's LeMoSp plan, what the next bill looks like, LeMo Tech's invoices and how to pay them. */
export default async function BillingPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "seeFinance")) redirect("/settings");
  const isManager = hasRole(roles, "management");

  const [book, settings, { data: billRow, error: billError }, { data: invRows }, { data: members }, { data: reqRows }] = await Promise.all([
    loadPriceBook(supabase),
    loadBillingSettings(supabase),
    supabase.from("company_billing").select("*").eq("company_id", company.id).maybeSingle(),
    supabase
      .from("platform_invoices")
      .select("id, number, currency, status, issued_on, due_on, total, paid_amount, period_start, period_end, created_at")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(60),
    supabase.from("memberships").select("role").eq("company_id", company.id).eq("active", true),
    supabase.from("service_requests").select("id, item_key, quantity, status").eq("company_id", company.id).in("status", ["approved", "delivered"]),
  ]);

  if (!book.ready || (billError && !billRow && /does not exist|schema cache/i.test(billError.message))) {
    return (
      <>
        <SettingsHead title={tr("Plan & billing")} icon="cash" />
        <p className="card muted">{tr(BILLING_MISSING)}</p>
      </>
    );
  }

  const b: CompanyBilling = (billRow as CompanyBilling | null) ?? {
    company_id: company.id,
    currency: "TZS",
    cycle: "monthly",
    discount_pct: 0,
    founding: false,
    status: "trial",
    trial_ends_on: null,
    next_invoice_on: null,
    billing_name: null,
    billing_email: null,
    billing_tin: null,
  };
  const status = ACCOUNT_STATUS[b.status] ?? ACCOUNT_STATUS.trial;
  const invoices = (invRows ?? []) as Pick<PlatformInvoice, "id" | "number" | "currency" | "status" | "issued_on" | "due_on" | "total" | "paid_amount" | "period_start" | "period_end" | "created_at">[];
  const team = (members ?? []) as { role: string }[];
  const drivers = team.filter((m) => m.role === "driver").length;
  const plan = planFor(book.items, company.business_level);
  const monthly = ((reqRows ?? []) as { id: string; item_key: string; quantity: number }[]).map((r) => ({ key: r.item_key, quantity: Number(r.quantity), requestId: r.id }));
  const lines = estimateMonthly({ items: book.items, level: company.business_level, currency: b.currency, members: team.length, drivers, monthly });
  const subtotal = sum(lines);
  const discount = Math.round((subtotal * Number(b.discount_pct)) / 100);
  const vatRate = settings?.vat_rate ?? 0;
  const vat = Math.round(((subtotal - discount) * vatRate) / 100);
  const balance = invoices.filter((i) => i.status === "issued").reduce((a, i) => a + Number(i.total) - Number(i.paid_amount), 0);
  const late = invoices.filter((i) => overdue(i));

  return (
    <>
      <SettingsHead
        title={tr("Plan & billing")}
        icon="cash"
        lead={tr("Your LeMoSp plan, what your next bill will look like, invoices from LeMo Tech and how to pay them.")}
      />
      <Notice {...notice} />

      {(b.status === "grace" || b.status === "read_only" || b.status === "suspended" || late.length > 0) && (
        <div className={`bl-banner${b.status === "read_only" || b.status === "suspended" ? " is-bad" : ""}`} role="status">
          <strong>{late.length > 0 ? tr("An invoice is overdue.") : tr(status.label)}</strong> {tr(status.help)}
        </div>
      )}

      <section className="card">
        <div className="line-head">
          <h2 style={{ margin: 0 }}>{plan ? tr(plan.name) : tr("Your plan")}</h2>
          <span className={`badge tone-${status.tone}`}>{tr(status.label)}</span>
        </div>
        <p className="muted small">{tr(status.help)}</p>
        <div className="bl-plan">
          <div className="bl-stat">
            <span>{tr("People with access")}</span>
            <strong>
              {team.length}
              {plan?.included_users ? ` / ${plan.included_users} ${tr("included")}` : ""}
            </strong>
          </div>
          <div className="bl-stat">
            <span>{tr("Billing")}</span>
            <strong>{tr(CYCLE_LABEL[b.cycle])}</strong>
          </div>
          <div className="bl-stat">
            <span>{tr("Currency")}</span>
            <strong>{b.currency}</strong>
          </div>
          <div className="bl-stat">
            <span>{tr("Still to pay")}</span>
            <strong>{formatMoney(balance, b.currency)}</strong>
          </div>
          {b.trial_ends_on && b.status === "trial" && (
            <div className="bl-stat">
              <span>{tr("Free trial ends")}</span>
              <strong>{formatDate(b.trial_ends_on)}</strong>
            </div>
          )}
          {b.next_invoice_on && (
            <div className="bl-stat">
              <span>{tr("Next invoice")}</span>
              <strong>{formatDate(b.next_invoice_on)}</strong>
            </div>
          )}
        </div>
        {(Number(b.discount_pct) > 0 || b.founding) && (
          <p className="small" style={{ marginBottom: 0 }}>
            {b.founding && <span className="badge tone-info">{tr("Founding client")}</span>}{" "}
            {Number(b.discount_pct) > 0 && `${tr("Your discount:")} ${Number(b.discount_pct)}%`}
          </p>
        )}
      </section>

      <section className="card">
        <h2>{tr("Your next monthly bill (estimate)")}</h2>
        <p className="muted small">
          {tr("Worked out from your business level, the people with access and the monthly services you have. One-off services are billed separately.")}
        </p>
        <div className="bl-wrap">
          <table className="bl-table">
            <thead>
              <tr>
                <th>{tr("Item")}</th>
                <th className="num">{tr("Qty")}</th>
                <th className="num">{tr("Price")}</th>
                <th className="num">{tr("Amount")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, n) => (
                <tr key={`${l.key}-${n}`}>
                  <td>{tr(l.description)}</td>
                  <td className="num">{l.quantity}</td>
                  <td className="num">{formatMoney(l.unit_price, b.currency)}</td>
                  <td className="num">{formatMoney(l.amount, b.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {discount > 0 && (
                <tr>
                  <td colSpan={3}>
                    {tr("Discount")} {Number(b.discount_pct)}%
                  </td>
                  <td className="num">−{formatMoney(discount, b.currency)}</td>
                </tr>
              )}
              <tr>
                <td colSpan={3}>{vatRate > 0 ? `${tr("VAT")} ${vatRate}%` : tr("VAT (LeMo Tech is not VAT-registered yet)")}</td>
                <td className="num">{formatMoney(vat, b.currency)}</td>
              </tr>
              <tr>
                <td colSpan={3}>{tr("Total per month")}</td>
                <td className="num">{formatMoney(subtotal - discount + vat, b.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="small" style={{ marginBottom: 0 }}>
          <Link href="/services">{tr("Add services, training or playbooks")} ›</Link>
        </p>
      </section>

      <section className="card" id="invoices">
        <h2>{tr("Invoices from LeMo Tech")}</h2>
        {invoices.length === 0 ? (
          <p className="muted">{tr("No invoices yet.")}</p>
        ) : (
          <ul className="list">
            {invoices.map((i) => {
              const st = overdue(i) ? { label: "Overdue", tone: "bad" } : (INVOICE_STATUS[i.status] ?? INVOICE_STATUS.issued);
              return (
                <li key={i.id}>
                  <div className="line-head">
                    <div style={{ minWidth: 0 }}>
                      <strong>{i.number}</strong> <span className={`badge tone-${st.tone}`}>{tr(st.label)}</span>
                      <div className="muted small">
                        {i.issued_on && formatDate(i.issued_on)}
                        {i.due_on && i.status === "issued" && (
                          <>
                            {" "}
                            · {tr("due")} {formatDate(i.due_on)}
                          </>
                        )}
                        {i.period_start && (
                          <>
                            {" "}
                            · {formatDate(i.period_start)} – {i.period_end ? formatDate(i.period_end) : ""}
                          </>
                        )}
                      </div>
                    </div>
                    <span className="row" style={{ gap: 8 }}>
                      <strong>{formatMoney(i.status === "issued" ? Number(i.total) - Number(i.paid_amount) : i.total, i.currency)}</strong>
                      <a className="btn btn-small" href={`/settings/billing/${i.id}/pdf`} target="_blank" rel="noopener">
                        {tr("PDF")}
                      </a>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card" id="pay">
        <h2>{tr("How to pay")}</h2>
        <p className="small">{tr("Use the invoice number as the payment reference. The LeMo Tech team records your payment and you get a notice in the app.")}</p>
        {settings?.mobile_money && (
          <>
            <h3>{tr("Mobile money")}</h3>
            <p className="bl-pay">{settings.mobile_money}</p>
          </>
        )}
        {settings?.bank_details && (
          <>
            <h3>{tr("Bank")}</h3>
            <p className="bl-pay">{settings.bank_details}</p>
          </>
        )}
        {!settings?.mobile_money && !settings?.bank_details && <p className="muted">{tr("LeMo Tech will send the payment details with your first invoice.")}</p>}
        {settings && (settings.phone || settings.email) && (
          <p className="small muted" style={{ marginBottom: 0 }}>
            {tr("Questions about a bill:")} {[settings.phone, settings.email].filter(Boolean).join(" · ")}
          </p>
        )}
      </section>

      <section className="card" id="details">
        <h2>{tr("Billing details")}</h2>
        <p className="muted small">{tr("Printed on LeMo Tech's invoices to you. Left empty, your company details are used.")}</p>
        {isManager ? (
          <form action={saveBillingDetails} className="stack">
            <label htmlFor="billing_name">{tr("Name on the invoice")}</label>
            <input id="billing_name" name="billing_name" maxLength={160} defaultValue={b.billing_name ?? ""} placeholder={company.name} />
            <label htmlFor="billing_email">{tr("Email for invoices")}</label>
            <input id="billing_email" name="billing_email" type="email" maxLength={160} defaultValue={b.billing_email ?? ""} />
            <label htmlFor="billing_tin">{tr("TIN")}</label>
            <input id="billing_tin" name="billing_tin" maxLength={40} defaultValue={b.billing_tin ?? ""} />
            <SubmitButton className="btn btn-primary" pendingText={tr("Saving…")}>
              {tr("Save")}
            </SubmitButton>
          </form>
        ) : (
          <dl className="kv">
            <dt>{tr("Name on the invoice")}</dt>
            <dd>{b.billing_name ?? company.name}</dd>
            <dt>{tr("Email for invoices")}</dt>
            <dd>{b.billing_email ?? "—"}</dd>
            <dt>{tr("TIN")}</dt>
            <dd>{b.billing_tin ?? "—"}</dd>
          </dl>
        )}
      </section>
    </>
  );
}
