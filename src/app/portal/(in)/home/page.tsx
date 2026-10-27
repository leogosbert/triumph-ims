import Link from "next/link";
import { tr } from "@/lib/tr";
import { requirePortal } from "@/lib/portal/server";

export const metadata = { title: "Home" };

export default async function PortalHome() {
  const { me } = await requirePortal();
  const n = (k: string) => Number(me.counts[k] ?? 0);
  const client = me.account.party === "client";
  const first = me.account.name.split(/\s+/)[0];
  const stats = client
    ? [
        { href: "/portal/quotations", n: n("quotations_to_answer"), l: "Quotations waiting for your answer", alert: n("quotations_to_answer") > 0 },
        { href: "/portal/orders", n: n("open_orders"), l: "Orders in progress" },
        { href: "/portal/orders", n: n("deliveries_on_the_way"), l: "Deliveries on the way" },
        { href: "/portal/invoices", n: n("unpaid_invoices"), l: "Unpaid invoices", alert: n("overdue_invoices") > 0 },
      ]
    : [
        { href: "/portal/rfqs", n: n("rfqs_to_answer"), l: "Requests for prices to answer", alert: n("rfqs_to_answer") > 0 },
        { href: "/portal/purchase-orders", n: n("orders_to_confirm"), l: "Purchase orders to confirm", alert: n("orders_to_confirm") > 0 },
        { href: "/portal/purchase-orders", n: n("open_orders"), l: "Orders to deliver" },
        { href: "/portal/send", n: n("submissions_waiting"), l: "Invoices and delivery notes being checked" },
      ];
  return (
    <>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>
          {tr("Welcome")}, {first}
        </h1>
      </div>
      <p className="muted small">
        {client
          ? tr("Here you see your quotations, orders, deliveries, invoices and the documents we share with you.")
          : tr("Here you answer our requests for prices, confirm our purchase orders and send us your delivery notes and invoices.")}
      </p>
      <div className="stat-grid">
        {stats.map((s) => (
          <Link key={s.l} href={s.href} className={`stat${s.alert ? " alert" : ""}`}>
            <span className="n">{s.n}</span>
            <span className="l">{tr(s.l)}</span>
          </Link>
        ))}
      </div>
      {!client && me.counts.bank_change_pending === true && (
        <p className="notice notice-ok">{tr("Your new bank details are waiting for our management's approval. We pay to the old account until then.")}</p>
      )}
      <section className="card">
        <h2>{tr("Questions?")}</h2>
        <p className="small" style={{ margin: 0 }}>
          {tr("Send us a message from Messages; it reaches our team at once.")}{" "}
          <Link href="/portal/messages">{tr("Write a message →")}</Link>
        </p>
      </section>
    </>
  );
}
