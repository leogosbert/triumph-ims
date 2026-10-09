import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { VEHICLE_KINDS, dueSoon, type Vehicle } from "@/lib/fleet";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";

export const metadata = { title: "Vehicles" };

export default async function FleetPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeFleet")) redirect("/");
  const showAll = sp.view === "all";
  let q = supabase
    .from("vehicles")
    .select("id, plate, name, kind, driver_id, insurance_expires, inspection_expires, service_due_on, service_due_km, odometer_km, remind_days, active")
    .eq("company_id", company.id)
    .order("plate");
  if (!showAll) q = q.eq("active", true);
  const { data, error } = await q;
  if (isMissingTable(error)) return <NotReady title="Vehicles" />;
  if (error) throw new Error(error.message);
  const vehicles = (data ?? []) as Vehicle[];
  const monthStart = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date()).slice(0, 8) + "01";
  const [names, { data: logData }] = await Promise.all([
    namesFor(supabase, vehicles.map((v) => v.driver_id)),
    supabase.from("vehicle_logs").select("vehicle_id, kind, litres, amount").eq("company_id", company.id).gte("happened_on", monthStart).limit(5000),
  ]);
  const logs = (logData ?? []) as { vehicle_id: string; kind: string; litres: number | null; amount: number | null }[];
  const spent = logs.reduce((s, l) => s + Number(l.amount ?? 0), 0);
  const fuel = logs.filter((l) => l.kind === "fuel").reduce((s, l) => s + Number(l.litres ?? 0), 0);
  const attention = vehicles.filter((v) => v.active && dueSoon(v).length > 0).length;

  return (
    <>
      <div className="page-head">
        <h1>{tr("Vehicles")}</h1>
        {can(role, "editFleet") && (
          <Link href="/fleet/new" className="btn btn-primary btn-small">
            {tr("+ Vehicle")}
          </Link>
        )}
      </div>
      <p className="muted small">{tr("Trucks and cars with their insurance, inspection and service dates, and a log of fuel and repairs.")}</p>
      <Notice {...notice} />
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{vehicles.filter((v) => v.active).length}</div>
          <div className="l">{tr("Vehicles in use")}</div>
        </div>
        <div className={`stat ${attention ? "alert" : ""}`}>
          <div className="n">{attention}</div>
          <div className="l">{tr("Need attention soon")}</div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(spent, company.base_currency)}</div>
          <div className="l">
            {tr("Fuel and repairs this month")} · {Math.round(fuel)} L
          </div>
        </div>
      </div>
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href="/fleet" aria-current={!showAll ? "page" : undefined}>
          {tr("In use")}
        </Link>
        <Link href="/fleet?view=all" aria-current={showAll ? "page" : undefined}>
          {tr("All")}
        </Link>
      </nav>
      {vehicles.length === 0 ? (
        <p className="card muted">{tr("No vehicles yet. Add your trucks and cars to be reminded of insurance, inspection and services.")}</p>
      ) : (
        <ul className="rec-list">
          {vehicles.map((v) => {
            const due = dueSoon(v);
            return (
              <li key={v.id}>
                <Link href={`/fleet/${v.id}`}>
                  <div className="main">
                    <div className="title">
                      {v.plate} {v.name && <span className="muted">· {v.name}</span>}
                    </div>
                    <div className="sub">
                      {tr(VEHICLE_KINDS[v.kind] ?? v.kind)}
                      {v.driver_id && names.get(v.driver_id) && ` · ${names.get(v.driver_id)}`}
                      {v.odometer_km != null && ` · ${v.odometer_km.toLocaleString("en-GB")} km`}
                    </div>
                  </div>
                  <div className="side">
                    {!v.active ? (
                      <span className="badge tone-off">{tr("Off the road")}</span>
                    ) : due.length > 0 ? (
                      <span className={`badge ${due[0].days < 0 ? "tone-bad" : "tone-warn"}`}>
                        {tr(due[0].label)} {due[0].on ? formatDate(due[0].on) : tr("due")}
                      </span>
                    ) : (
                      <span className="badge tone-ok">{tr("All in order")}</span>
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
