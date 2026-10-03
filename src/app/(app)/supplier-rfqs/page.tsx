import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { SRFQ_STATUS } from "@/lib/purchasing";
import { LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";

export const metadata = { title: "Supplier RFQs" };

const TABS = [
  { key: "open", label: "Collecting prices", statuses: ["open"] },
  { key: "awarded", label: "Awarded", statuses: ["awarded"] },
  { key: "all", label: "All", statuses: [] as string[] },
];

type Row = { id: string; number: string; title: string | null; status: string; due_on: string | null; invites: { status: string }[] };

export default async function SupplierRfqsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editPurchasing")) redirect("/");

  let query = supabase
    .from("supplier_rfqs")
    .select("id, number, title, status, due_on, invites:supplier_rfq_suppliers(status)")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (tab.statuses.length) query = query.in("status", tab.statuses);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const today = todayTz();

  return (
    <>
      <p className="small">
        <Link href="/purchasing">← Purchasing</Link>
      </p>
      <div className="page-head">
        <h1>Supplier RFQs</h1>
        <Link href="/supplier-rfqs/new" className="btn btn-primary btn-small">
          + New
        </Link>
      </div>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label="Filter">
        {TABS.map((t) => (
          <Link key={t.key} href={`/supplier-rfqs?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="card muted">Nothing here.</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const quoted = r.invites.filter((i) => i.status === "quoted").length;
            return (
              <li key={r.id}>
                <Link href={`/supplier-rfqs/${r.id}`}>
                  <div className="main">
                    <div className="title">{r.title ?? r.number}</div>
                    <div className="sub">
                      {r.number} · {quoted} of {r.invites.length} supplier{r.invites.length === 1 ? "" : "s"} priced
                    </div>
                  </div>
                  <div className="side">
                    <StatusBadge map={SRFQ_STATUS} status={r.status} />
                    {r.due_on && r.status === "open" && (
                      <div className={`small ${r.due_on < today ? "text-warn" : "muted"}`}>Reply by {formatDate(r.due_on)}</div>
                    )}
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
