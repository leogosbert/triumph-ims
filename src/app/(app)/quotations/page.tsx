import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { cleanSearch, LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { QUOTE_STATUS, quoteNo, StatusBadge, todayTz } from "@/lib/sales";

export const metadata = { title: "Quotations" };

const TABS = [
  { key: "open", label: "In progress", statuses: ["draft", "pending_approval", "approved", "sent"] },
  { key: "approval", label: "Waiting for approval", statuses: ["pending_approval"] },
  { key: "sent", label: "Sent", statuses: ["sent"] },
  { key: "accepted", label: "Accepted", statuses: ["accepted"] },
  { key: "closed", label: "Rejected / cancelled", statuses: ["rejected", "cancelled"] },
  { key: "all", label: "All", statuses: [] as string[] },
];

type Row = {
  id: string;
  number: string;
  revision: number;
  status: string;
  total: number;
  currency: string;
  issue_date: string;
  valid_until: string | null;
  client: { name: string } | null;
};

export default async function QuotationsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const q = cleanSearch(typeof sp.q === "string" ? sp.q : "");
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeSales")) redirect("/");

  let query = supabase
    .from("quotations")
    .select("id, number, revision, status, total, currency, issue_date, valid_until, client:clients(name)", {
      count: "exact",
    })
    .eq("company_id", company.id)
    .neq("status", "superseded")
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (tab.statuses.length) query = query.in("status", tab.statuses);
  if (q) query = query.or(`number.ilike.%${q}%,client_ref.ilike.%${q}%`);
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const today = todayTz();

  return (
    <>
      <p className="small">
        <Link href="/sales">{tr("← Sales")}</Link>
      </p>
      <div className="page-head">
        <h1>{tr("Quotations")}</h1>
        {can(role, "editSales") && (
          <Link href="/quotations/new" className="btn btn-primary btn-small">{tr("+ New quotation")}</Link>
        )}
      </div>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Filter")}>
        {TABS.map((t) => (
          <Link key={t.key} href={`/quotations?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>
            {tr(String(t.label ?? ""))}
          </Link>
        ))}
      </nav>
      <form method="get" className="toolbar-row" style={{ marginBottom: 12 }}>
        <input type="hidden" name="tab" value={tab.key} />
        <input type="search" name="q" defaultValue={q} placeholder={tr("Search quotation no. or client ref…")} />
        <button className="btn" type="submit">{tr("Search")}</button>
      </form>
      {rows.length === 0 ? (
        <p className="card muted">{tr("No quotations here.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const expired = r.valid_until && r.valid_until < today && ["approved", "sent"].includes(r.status);
            return (
              <li key={r.id}>
                <Link href={`/quotations/${r.id}`}>
                  <div className="main">
                    <div className="title">{r.client?.name ?? tr("Client")}</div>
                    <div className="sub">
                      {quoteNo(r)} · {formatDate(r.issue_date)}
                      {expired && <span className="text-warn">{" "}{tr("· validity expired")}</span>}
                    </div>
                  </div>
                  <div className="side">
                    {formatMoney(r.total, r.currency)}
                    <div>
                      <StatusBadge map={QUOTE_STATUS} status={r.status} />
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {(count ?? 0) > LIST_LIMIT && <p className="muted small">{tr("Showing the first")}{" "}{LIST_LIMIT}.</p>}
    </>
  );
}
