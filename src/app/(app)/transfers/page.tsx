import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { TRANSFER_STATUS, storeOptions } from "@/lib/stock";

export const metadata = { title: "Stock transfers" };

type Row = {
  id: string;
  number: string;
  status: string;
  reason: string | null;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
  from_warehouse_id: string;
  to_warehouse_id: string;
  lines: { count: number }[];
};

export default async function TransfersPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeStock")) redirect("/");
  const view = sp.view === "done" ? "done" : "open";
  let q = supabase
    .from("stock_transfers")
    .select("id, number, status, reason, created_at, sent_at, received_at, from_warehouse_id, to_warehouse_id, lines:stock_transfer_lines(count)")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(500);
  q = view === "open" ? q.in("status", ["draft", "in_transit"]) : q.in("status", ["received", "cancelled"]);
  const { data, error } = await q;
  if (isMissingTable(error)) return <NotReady title="Stock transfers" />;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];
  const stores = new Map((await storeOptions(supabase, company.id, false)).map((s) => [s.id, s.name]));

  return (
    <>
      <p className="small">
        <Link href="/stock">{tr("← Stock")}</Link>
      </p>
      <div className="page-head">
        <h1>{tr("Stock transfers")}</h1>
        {can(role, "moveStock") && (
          <Link href="/transfers/new" className="btn btn-primary btn-small">
            {tr("+ Transfer")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Move stock from one store to another. Batches and expiry dates go with the goods.")}</p>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/transfers" aria-current={view === "open" ? "page" : undefined}>
          {tr("Open")}
        </Link>
        <Link href="/transfers?view=done" aria-current={view === "done" ? "page" : undefined}>
          {tr("Done")}
        </Link>
      </nav>
      {rows.length === 0 ? (
        <p className="card muted">{view === "open" ? tr("No transfers being prepared or on the way.") : tr("No finished transfers yet.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((t) => (
            <li key={t.id}>
              <Link href={`/transfers/${t.id}`}>
                <div className="main">
                  <div className="title">
                    {stores.get(t.from_warehouse_id)} → {stores.get(t.to_warehouse_id)}
                  </div>
                  <div className="sub">
                    {t.number} · {t.lines?.[0]?.count ?? 0} {tr("items")} · {formatDate(t.received_at ?? t.sent_at ?? t.created_at)}
                    {t.reason && ` · ${t.reason}`}
                  </div>
                </div>
                <div className="side">
                  <StatusBadge map={TRANSFER_STATUS} status={t.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
