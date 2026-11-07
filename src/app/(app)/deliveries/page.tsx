import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { getAppContext, noAccess } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { LIST_LIMIT } from "@/lib/records";
import { can, onlyRoles } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import { DELIVERY_STATUS } from "@/lib/stock";
import { BackLink } from "@/components/BackLink";
import { FilterChips } from "@/components/lists/FilterChips";
import { ListSort } from "@/components/lists/ListSort";
import { SwipeRow } from "@/components/lists/SwipeRow";
import { readSort, sortLinks, sortRows, weekAhead, type SortOption } from "@/lib/list-view";

export const metadata = { title: "Deliveries" };

const TABS = [
  { key: "open", label: "To deliver", statuses: ["draft", "dispatched"] },
  { key: "week", label: "This week", statuses: ["draft", "dispatched"] },
  { key: "dispatched", label: "On the way", statuses: ["dispatched"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "problems", label: "Failed / cancelled", statuses: ["failed", "cancelled"] },
  { key: "all", label: "All", statuses: [] as string[] },
];

const SORTS: SortOption[] = [
  { key: "planned", label: "Planned date", col: "planned_date", dir: "asc" },
  { key: "newest", label: "Newest", col: "created_at", dir: "desc" },
  { key: "client", label: "Client", dir: "asc" },
  { key: "status", label: "Status", col: "status", dir: "asc" },
];

type Row = {
  id: string;
  number: string;
  status: string;
  planned_date: string | null;
  delivered_at: string | null;
  vehicle: string | null;
  contact_phone: string | null;
  client: { name: string } | null;
};

export default async function DeliveriesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const { supabase, company, roles } = await getAppContext();
  if (onlyRoles(roles, "driver")) redirect("/driver");
  if (!can(roles, "seeDeliveries")) noAccess();

  // Open deliveries come soonest first; finished ones newest first, as before.
  const sort = readSort(sp, SORTS, "planned");
  const planned = sort.key === "planned" && !sort.explicit ? { col: "planned_date", ascending: tab.key === "open" || tab.key === "week" } : null;
  let q = supabase
    .from("deliveries")
    .select("id, number, status, planned_date, delivered_at, vehicle, contact_phone, client:clients(name)")
    .eq("company_id", company.id)
    .order(planned?.col ?? sort.opt.col ?? "created_at", {
      ascending: planned ? planned.ascending : sort.opt.col ? sort.ascending : false,
      nullsFirst: false,
    })
    .order("created_at", { ascending: false })
    .limit(LIST_LIMIT);
  if (tab.statuses.length) q = q.in("status", tab.statuses);
  if (tab.key === "week") {
    const week = weekAhead(todayTz());
    q = q.lte("planned_date", week.to);
  }
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const loaded = (data ?? []) as unknown as Row[];
  const rows = sort.key === "client" ? sortRows(loaded, (r) => r.client?.name, sort.dir) : loaded;

  return (
    <>
      <BackLink href="/stock" label="Stock" />
      <div className="page-head">
        <h1>{tr("Deliveries")}</h1>
        {can(roles, "editDeliveries") && (
          <Link href="/deliveries/new" className="btn btn-primary btn-small">{tr("+ Delivery note")}</Link>
        )}
      </div>
      <p className="small">
        <Link href="/backorders">{tr("Still to deliver")} →</Link>
      </p>
      <Notice {...notice} />
      <FilterChips
        list="deliveries"
        current={tab.key}
        explicit={typeof sp.tab === "string"}
        chips={TABS.map((t) => ({ key: t.key, label: t.label, href: `/deliveries?tab=${t.key}` }))}
      />
      {rows.length > 1 && <ListSort links={sortLinks("/deliveries", sp, SORTS, sort)} />}
      {rows.length === 0 ? (
        <p className="card muted">{tr("No deliveries here. Delivery notes are usually created from an accepted quotation.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => (
            <SwipeRow
              key={r.id}
              href={`/deliveries/${r.id}`}
              actions={
                r.contact_phone && ["draft", "dispatched"].includes(r.status)
                  ? [{ label: "Call", href: `tel:${r.contact_phone.replace(/[^\d+]/g, "")}`, tone: "call" }]
                  : []
              }
            >
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
            </SwipeRow>
          ))}
        </ul>
      )}
    </>
  );
}
