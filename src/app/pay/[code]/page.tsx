import { AppBackground } from "@/components/AppBackground";
import { gatewayFor } from "@/lib/getpaid/gateways";
import { inboxAdmin } from "@/lib/inbox/server";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { primeLang, tr } from "@/lib/tr";
import { PayForm } from "./PayForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pay invoice", robots: { index: false, follow: false } };

type PublicLink = {
  status: "open" | "paid" | "cancelled";
  provider: string | null;
  allow_partial: boolean;
  company: { name: string; phone: string | null; email: string | null; bank_details: string | null; mobile_money_details: string | null };
  invoice: { number: string; client: string | null; issue_date: string | null; due_date: string | null; currency: string; total: number; paid: number; balance: number };
};

/**
 * Public pay page (no sign-in): https://<site>/pay/<code>. The code is a 32-character random value
 * printed on the invoice; it shows only what the client already has on the invoice.
 */
export default async function PayPage({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await primeLang();
  const { code } = await params;
  const sp = await searchParams;
  const db = inboxAdmin();
  const data = db && /^[a-f0-9]{32}$/.test(code) ? ((await db.rpc("pay_link_public", { p_code: code })).data as PublicLink | null) : null;

  if (!data) {
    return (
      <div className="auth-wrap">
        <AppBackground kind="architecture" />
        <article className="auth-card">
          <h1>{tr("Pay link not found")}</h1>
          <p className="muted">{tr("Check the link on your invoice, or contact the company that sent it.")}</p>
        </article>
      </div>
    );
  }

  const inv = data.invoice;
  const gw = gatewayFor(data.provider);
  const online = data.status === "open" && gw !== null && gw.configured() && inv.currency === "TZS";
  const done = sp.done === "1";

  return (
    <div className="auth-wrap">
      <AppBackground kind="architecture" />
      <article className="auth-card">
        <p className="small muted" style={{ marginBottom: 4 }}>
          {data.company.name}
        </p>
        <h1 style={{ marginTop: 0 }}>
          {tr("Invoice")} {inv.number}
        </h1>
        <dl className="kv">
          {inv.client ? (
            <>
              <dt>{tr("For")}</dt>
              <dd>{inv.client}</dd>
            </>
          ) : null}
          {inv.due_date ? (
            <>
              <dt>{tr("Due date")}</dt>
              <dd>{formatDate(inv.due_date)}</dd>
            </>
          ) : null}
          <dt>{tr("Invoice total")}</dt>
          <dd>{formatMoney(inv.total, inv.currency)}</dd>
          {Number(inv.paid) > 0 ? (
            <>
              <dt>{tr("Paid")}</dt>
              <dd>{formatMoney(inv.paid, inv.currency)}</dd>
            </>
          ) : null}
          <dt>
            <strong>{tr("Balance due")}</strong>
          </dt>
          <dd>
            <strong>{formatMoney(inv.balance, inv.currency)}</strong>
          </dd>
        </dl>

        {data.status === "paid" ? (
          <p className="notice notice-ok" style={{ marginTop: 16 }}>
            {tr("This invoice is paid. Thank you!")}
          </p>
        ) : data.status === "cancelled" ? (
          <p className="notice" style={{ marginTop: 16 }}>
            {tr("This pay link is no longer valid. Please contact the company.")}
          </p>
        ) : (
          <>
            {done ? (
              <p className="notice notice-ok" style={{ marginTop: 16 }}>
                {tr("Thank you. Your payment is being confirmed; the invoice shows it as paid as soon as it arrives.")}
              </p>
            ) : null}
            {online && gw ? (
              <div style={{ marginTop: 16 }}>
                <PayForm code={code} balance={Number(inv.balance)} currency={inv.currency} allowPartial={data.allow_partial} methods={gw.methods} />
              </div>
            ) : null}
            {data.company.mobile_money_details || data.company.bank_details ? (
              <section style={{ marginTop: 16 }}>
                <h2 className="small" style={{ marginBottom: 4 }}>
                  {online ? tr("Or pay directly") : tr("How to pay")}
                </h2>
                {data.company.mobile_money_details ? <p className="small" style={{ whiteSpace: "pre-line" }}>{data.company.mobile_money_details}</p> : null}
                {data.company.bank_details ? <p className="small" style={{ whiteSpace: "pre-line" }}>{data.company.bank_details}</p> : null}
                <p className="small muted">
                  {tr("Use the invoice number as the payment reference:")} {inv.number}
                </p>
              </section>
            ) : null}
          </>
        )}
        {data.company.phone || data.company.email ? (
          <p className="small muted" style={{ marginTop: 16 }}>
            {tr("Questions?")} {[data.company.phone, data.company.email].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </article>
    </div>
  );
}
