import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { REQUEST_STATUS } from "@/lib/stock";

export const metadata = { title: "Purchase requests" };

type Row = {
  id: string;
  number: string;
  status: string;
  reason: string | null;
  needed_by: string | null;
  created_by: string | null;
  created_at: string;
  lines: { count: number }[];
};

const VIEWS: Record<string, { label: string; statuses: string[] }> = {
  open: { label: "Open", statuses: ["draft", "submitted", "approved"] },
  approve: { label: "To approve", statuses: ["submitted"] },
  order: { label: "To order", statuses: ["approved"] },
  done: { label: "Done", statuses: ["ordered", "rejected", "cancelled"] },
};

export default async function RequisitionsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  if (!can(role, "requestPurchases")) redirect("/");
  const tabs = ["open", ...(role === "management" ? ["approve"] : []), ...(can(role, "seeAllRequests") ? ["order"] : []), "done"];
  const view = typeof sp.view === "string" && tabs.includes(sp.view) ? sp.view : "open";
  const { data, error } = await supabase
    .from("requisitions")
    .select("id, number, status, reason, needed_by, created_by, created_at, lines:requisition_lines(count)")
    .eq("company_id", company.id)
    .in("status", VIEWS[view].statuses)
    .order("created_at", { ascending: false })
    .limit(500);
  if (isMissingTable(error)) return <NotReady title="Purchase requests" />;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const names = await namesFor(supabase, rows.map((r) => r.created_by));

  return (
    <>
      <div className="page-head">
        <h1>{tr("Purchase requests")}</h1>
        <Link href="/requisitions/new" className="btn btn-primary btn-small">
          {tr("+ Request")}
        </Link>
      </div>
      <p className="muted small">
        {can(role, "seeAllRequests")
          ? tr("Requests from the team for goods to buy. Management approves; procurement turns them into purchase orders.")
          : tr("Ask for goods the business should buy. Management approves and procurement orders them.")}
      </p>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        {tabs.map((k) => (
          <Link key={k} href={k === "open" ? "/requisitions" : `/requisitions?view=${k}`} aria-current={view === k ? "page" : undefined}>
            {tr(VIEWS[k].label)}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="card muted">{tr("Nothing here.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/requisitions/${r.id}`}>
                <div className="main">
                  <div className="title">{r.reason ?? r.number}</div>
                  <div className="sub">
                    {r.number} · {r.lines?.[0]?.count ?? 0} {tr("items")}
                    {r.created_by && r.created_by !== user.id && names.get(r.created_by) && ` · ${names.get(r.created_by)}`}
                    {r.needed_by ? ` · ${tr("needed by")} ${formatDate(r.needed_by)}` : ` · ${formatDate(r.created_at)}`}
                  </div>
                </div>
                <div className="side">
                  <StatusBadge map={REQUEST_STATUS} status={r.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
