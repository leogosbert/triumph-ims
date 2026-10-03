import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { LIST_LIMIT } from "@/lib/records";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { DELIVERY_STATUS } from "@/lib/stock";

export const metadata = { title: "Deliveries" };

const TABS = [
  { key: "open", label: "To deliver", statuses: ["draft", "dispatched"] },
  { key: "dispatched", label: "On the way", statuses: ["dispatched"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "problems", label: "Failed / cancelled", statuses: ["failed", "cancelled"] },
  { key: "all", label: "All", statuses: [] as string[] },
];

type Row = { id: string; number: string; status: string; planned_date: string | null; delivered_at: string | null; vehicle: string | null; client: { name: string } | null };

export default async function DeliveriesPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const { supabase, company, role } = await getAppContext();
  if (role === "driver") redirect("/driver");
  if (!can(role, "seeDeliveries")) redirect("/");

  let q = supabase
    .from("deliveries")
    .select("id, number, status, planned_date, delivered_at, vehicle, client:clients(name)")
    .eq("company_id", company.id)
    .order("planned_date", { ascending: tab.key === "open", nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (tab.statuses.length) q = q.in("status", tab.statuses);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as unknown as Row[];

  return (
    <>
      <p className="small">
        <Link href="/stock">← Stock</Link>
      </p>
      <div className="page-head">
        <h1>Deliveries</h1>
        {can(role, "editDeliveries") && (
          <Link href="/deliveries/new" className="btn btn-primary btn-small">
            + Delivery note
          </Link>
        )}
      </div>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label="Filter">
        {TABS.map((t) => (
          <Link key={t.key} href={`/deliveries?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="card muted">
          No deliveries here. Delivery notes are usually created from an accepted quotation.
        </p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/deliveries/${r.id}`}>
                <div className="main">
                  <div className="title">{r.client?.name}</div>
                  <div className="sub">
                    {r.number}
                    {r.status === "delivered" && r.delivered_at
                      ? ` · delivered ${formatDate(r.delivered_at)}`
                      : r.planned_date
                        ? ` · planned ${formatDate(r.planned_date)}`
                        : ""}
                    {r.vehicle ? ` · ${r.vehicle}` : ""}
                  </div>
                </div>
                <div className="side">
                  <StatusBadge map={DELIVERY_STATUS} status={r.status} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
