import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { primeLang, tr } from "@/lib/tr";
import { GetPaidTabs } from "./parts";

export const metadata = { title: "Getting paid" };

type FiscalSummary = { set_up: boolean; mode: string | null; registered: boolean | null; to_type: number; queued: number; failed: number; without: number };

export default async function GettingPaidPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features } = await getAppContext();
  if (!can(role, "seeFinance")) redirect("/");

  const [fiscal, pay, rem, orders, logs] = await Promise.all([
    supabase.rpc("fiscal_summary", { p_company: company.id }),
    supabase.from("pay_settings").select("provider").eq("company_id", company.id).maybeSingle(),
    supabase.from("reminder_settings").select("enabled, channels").eq("company_id", company.id).maybeSingle(),
    supabase.from("pay_orders").select("status, amount_paid").eq("company_id", company.id).eq("status", "paid").gte("paid_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
    supabase.from("reminder_log").select("status").eq("company_id", company.id).gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString()),
  ]);
  if (isMissingTable(fiscal.error) || isMissingTable(pay.error)) return <NotReady title="Getting paid" />;
  const fs = (fiscal.data ?? {}) as FiscalSummary;
  const paidOnline = (orders.data ?? []).length;
  const sentReminders = ((logs.data ?? []) as { status: string }[]).filter((l) => l.status === "sent").length;

  const cards = [
    {
      key: "tra_fiscal",
      href: "/getting-paid/tra",
      title: "TRA receipts",
      line: !fs.set_up
        ? tr("Not set up yet: choose manual (EFD machine) or VFD.")
        : `${tr(fs.mode === "vfd" ? "VFD (sent by the app)" : "Manual (EFD machine)")} · ${fs.to_type} ${tr("to enter")} · ${fs.failed} ${tr("not sent")}`,
      alert: fs.failed > 0 || fs.to_type > 0,
    },
    {
      key: "pay_links",
      href: "/getting-paid/links",
      title: "Pay links",
      line: pay.data?.provider ? `${tr("Online payment by")} ${pay.data.provider} · ${paidOnline} ${tr("paid in the last 30 days")}` : tr("Choose a payment service to take mobile money and cards."),
      alert: false,
    },
    {
      key: "auto_reminders",
      href: "/getting-paid/reminders",
      title: "Automatic reminders",
      line: rem.data?.enabled ? `${tr("On")} · ${sentReminders} ${tr("sent in the last 30 days")}` : tr("Off: nothing is sent until you switch it on."),
      alert: false,
    },
  ];

  return (
    <>
      <h1>{tr("Getting paid")}</h1>
      <p className="muted">{tr("TRA fiscal receipts, online pay links and automatic reminders, so invoices are paid on time.")}</p>
      <Notice msg={notice.msg} error={notice.error} />
      <GetPaidTabs current="/getting-paid" />
      <div className="grid grid-2">
        {cards.map((c) => (
          <section key={c.key} className="card">
            <h2 style={{ marginTop: 0 }}>
              <Link href={c.href}>{tr(c.title)}</Link>
            </h2>
            {features.on(c.key) ? (
              <p className={c.alert ? "text-warn" : "muted"} style={{ marginBottom: 0 }}>
                {c.line}
              </p>
            ) : (
              <p className="muted small" style={{ marginBottom: 0 }}>
                {tr("Switched off for this company.")}
              </p>
            )}
          </section>
        ))}
      </div>
    </>
  );
}
