import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { TENDER_BADGE, darDateTime, isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { closingIn } from "@/lib/crmText";

export const metadata = { title: "Tenders" };

type Row = {
  id: string;
  number: string;
  title: string;
  buyer_name: string | null;
  reference: string | null;
  closing_at: string;
  status: string;
  our_price: number | null;
  winning_price: number | null;
  currency: string;
  client: { name: string } | null;
};

export default async function TendersPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/");
  const view = sp.view === "decided" ? "decided" : "open";
  const { data, error } = await supabase
    .from("tenders")
    .select("id, number, title, buyer_name, reference, closing_at, status, our_price, winning_price, currency, client:clients(name)")
    .eq("company_id", company.id)
    .order("closing_at", { ascending: view === "open" })
    .limit(1000);
  if (isMissingTable(error)) return <NotReady title="Tenders" />;
  if (error) throw new Error(error.message);
  const all = (data ?? []) as unknown as Row[];
  const openRows = all.filter((t) => t.status === "preparing" || t.status === "submitted");
  const decided = all.filter((t) => !(t.status === "preparing" || t.status === "submitted"));
  const rows = view === "open" ? openRows : decided;
  const won = decided.filter((t) => t.status === "won").length;
  const lost = decided.filter((t) => t.status === "lost").length;
  const soon = openRows.filter((t) => t.status === "preparing" && closingIn(t.closing_at).urgent).length;

  return (
    <>
      <p className="small">
        <Link href="/crm">{tr("← Pipeline")}</Link>
      </p>
      <div className="page-head">
        <h1>{tr("Tenders")}</h1>
        <Link href="/tenders/new" className="btn btn-primary btn-small">
          {tr("+ Tender")}
        </Link>
      </div>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/tenders" aria-current={view === "open" ? "page" : undefined}>
          {tr("Open")} ({openRows.length})
        </Link>
        <Link href="/tenders?view=decided" aria-current={view === "decided" ? "page" : undefined}>
          {tr("Results")} ({decided.length})
        </Link>
      </nav>
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{openRows.filter((t) => t.status === "preparing").length}</div>
          <div className="l">{tr("Being prepared")}</div>
        </div>
        <div className="stat">
          <div className={`n${soon ? " text-warn" : ""}`}>{soon}</div>
          <div className="l">{tr("Closing within 2 days")}</div>
        </div>
        <div className="stat">
          <div className="n">{openRows.filter((t) => t.status === "submitted").length}</div>
          <div className="l">{tr("Waiting for the result")}</div>
        </div>
        <div className="stat">
          <div className="n">{won + lost > 0 ? `${Math.round((won / (won + lost)) * 100)}%` : "—"}</div>
          <div className="l">{tr("Tenders won")}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="card muted">
          {view === "open" ? tr("No open tenders. Add one with “+ Tender” when you see an advert or receive an invitation.") : tr("No results recorded yet.")}
        </p>
      ) : (
        <ul className="rec-list">
          {rows.map((t) => {
            const left = closingIn(t.closing_at);
            return (
              <li key={t.id}>
                <Link href={`/tenders/${t.id}`}>
                  <div className="main">
                    <div className="title">{t.client?.name ?? t.buyer_name}</div>
                    <div className="sub">
                      {t.title}
                      {t.reference && ` · ${t.reference}`}
                    </div>
                    <div className="sub">
                      {tr("Closes")} {darDateTime(t.closing_at)}
                      {t.status === "preparing" && <span className={left.urgent ? "text-warn" : undefined}> · {left.text}</span>}
                    </div>
                  </div>
                  <div className="side">
                    <StatusBadge map={TENDER_BADGE} status={t.status} />
                    {t.our_price !== null && <div className="small">{formatMoney(t.our_price, t.currency)}</div>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
