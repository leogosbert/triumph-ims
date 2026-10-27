import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, noAccess } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDateTime } from "@/lib/format";
import { PAY_ORDER_STATUS } from "@/lib/getpaid/common";
import { gatewayList } from "@/lib/getpaid/gateways";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { siteUrl } from "@/lib/supabase/env";
import { primeLang, tr } from "@/lib/tr";
import { savePaySettings } from "../actions";
import { FeatureOff, GetPaidTabs, Ready } from "../parts";
import { MatchTool } from "./MatchTool";

export const metadata = { title: "Pay links" };

type Order = {
  id: string;
  order_id: string;
  provider: string;
  amount: number;
  currency: string;
  status: string;
  channel: string | null;
  payer_phone: string | null;
  note: string | null;
  created_at: string;
  paid_at: string | null;
  invoice: { id: string; number: string } | null;
};
type Event = { id: string; provider: string; order_id: string | null; verified: boolean; outcome: string; received_at: string };

const OUTCOME: Record<string, string> = {
  recorded: "Payment recorded",
  recorded_overpaid: "Recorded; paid more than owed",
  overpaid: "Paid, but nothing was owed",
  matched: "Matched a payment typed by hand",
  duplicate: "Repeat message",
  pending: "Waiting",
  failed: "Payment failed",
  unknown_order: "Unknown order",
};

export default async function PayLinksPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, isManager, features } = await getAppContext();
  if (!can(roles, "seeFinance")) noAccess();

  const [setRes, ordRes, evRes] = await Promise.all([
    supabase.from("pay_settings").select("provider, on_documents, allow_partial").eq("company_id", company.id).maybeSingle(),
    supabase
      .from("pay_orders")
      .select("id, order_id, provider, amount, currency, status, channel, payer_phone, note, created_at, paid_at, invoice:invoices(id, number)")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(40),
    supabase.from("pay_events").select("id, provider, order_id, verified, outcome, received_at").eq("company_id", company.id).order("received_at", { ascending: false }).limit(20),
  ]);
  if (isMissingTable(setRes.error)) return <NotReady title="Pay links" />;
  const s = setRes.data as { provider: string | null; on_documents: boolean; allow_partial: boolean } | null;
  const orders = (ordRes.data ?? []) as unknown as Order[];
  const events = (evRes.data ?? []) as Event[];
  const gateways = gatewayList();
  const chosen = gateways.find((g) => g.id === s?.provider);

  return (
    <>
      <h1>{tr("Pay links")}</h1>
      <p className="muted">{tr("Each issued invoice gets a link (and QR code) the client opens to pay by M-Pesa, Airtel Money, Mixx by Yas, HaloPesa or card. The payment is recorded on the invoice by itself.")}</p>
      <Notice msg={notice.msg} error={notice.error} />
      <GetPaidTabs current="/getting-paid/links" />
      {!features.on("pay_links") && <FeatureOff name="Pay links" isManager={isManager} />}

      <section className="card">
        <h2>{tr("Payment service")}</h2>
        <form action={savePaySettings}>
          <fieldset disabled={!isManager} style={{ border: 0, padding: 0, margin: 0 }}>
            <div className="field">
              <label htmlFor="provider">{tr("Service")}</label>
              <select id="provider" name="provider" defaultValue={s?.provider ?? ""}>
                <option value="">{tr("None (the link shows the bank and mobile money details only)")}</option>
                {gateways.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label} ({g.methods.join(", ")})
                  </option>
                ))}
              </select>
            </div>
            <label className="check">
              <input type="checkbox" name="on_documents" defaultChecked={s?.on_documents ?? true} /> {tr("Print the pay link and QR code on invoices")}
            </label>
            <label className="check">
              <input type="checkbox" name="allow_partial" defaultChecked={s?.allow_partial ?? false} /> {tr("Let clients pay part of the balance")}
            </label>
            {isManager && <SubmitButton pendingText={tr("Saving…")}>{tr("Save")}</SubmitButton>}
          </fieldset>
        </form>
        {chosen ? (
          <>
            <ul className="list" style={{ marginTop: 12 }}>
              <Ready ok={chosen.configured} label={`${chosen.label} keys on the server`} hint="LeMo Tech adds the merchant keys in Netlify (see the setup notes)." />
            </ul>
            <p className="small">
              {tr("Give the payment service this notification address (webhook):")} <code>{`${siteUrl()}/api/payments/${chosen.id}`}</code>
            </p>
          </>
        ) : null}
        <p className="small muted">{tr("Online payment is for invoices in TZS. Not yet checked against the payment service's live system: make a small test payment first.")}</p>
      </section>

      <section className="card">
        <h2>{tr("Match references")}</h2>
        <MatchTool />
      </section>

      <section className="card">
        <h2>{tr("Online payments")}</h2>
        {orders.length === 0 ? (
          <p className="muted small">{tr("No online payments yet.")}</p>
        ) : (
          <ul className="list">
            {orders.map((o) => (
              <li key={o.id}>
                <div className="row">
                  <span>
                    {o.invoice ? <Link href={`/invoices/${o.invoice.id}`}>{o.invoice.number}</Link> : "—"} · {formatMoney(o.amount, o.currency)} · {formatDateTime(o.paid_at ?? o.created_at)}
                    <div className="small muted">
                      {o.order_id}
                      {o.channel ? ` · ${o.channel}` : ""}
                      {o.payer_phone ? ` · ${o.payer_phone}` : ""}
                    </div>
                  </span>
                  <StatusBadge map={PAY_ORDER_STATUS} status={o.status} />
                </div>
                {o.note ? <div className="small text-warn">{o.note}</div> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {events.length > 0 && (
        <details className="card">
          <summary>
            <strong>{tr("Messages from the payment service")}</strong>
          </summary>
          <ul className="list" style={{ marginTop: 12 }}>
            {events.map((e) => (
              <li key={e.id} className="small">
                {formatDateTime(e.received_at)} · {e.provider} · {e.order_id ?? "—"} ·{" "}
                <span className={`badge tone-${e.verified ? "ok" : "bad"}`}>{e.verified ? tr(OUTCOME[e.outcome] ?? e.outcome) : `${tr("Refused")}: ${e.outcome}`}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
