import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { DRIVER_LOG_KINDS, LOG_KINDS, VEHICLE_KINDS, dueSoon, plateKey, type Vehicle } from "@/lib/fleet";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { companyPeople, namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import { DELIVERY_STATUS } from "@/lib/stock";
import { addVehicleLog, removeVehicleLog, saveVehicle } from "../actions";
import { VehicleFields } from "../VehicleFields";

export const metadata = { title: "Vehicle" };

type Log = { id: string; kind: string; happened_on: string; odometer_km: number | null; litres: number | null; amount: number | null; note: string | null; created_by: string | null };
type Trip = { id: string; number: string; status: string; planned_date: string | null; vehicle: string | null; client: { name: string } | null };

export default async function VehiclePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  if (!can(role, "seeFleet")) redirect("/");
  const { data: v, error } = await supabase.from("vehicles").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Vehicle" />;
  if (!v) notFound();
  const vehicle = v as Vehicle & { capacity_kg: number | null; notes: string | null };
  const editor = can(role, "editFleet");
  const [{ data: logData }, people, { data: tripData }] = await Promise.all([
    supabase.from("vehicle_logs").select("id, kind, happened_on, odometer_km, litres, amount, note, created_by").eq("vehicle_id", id).order("happened_on", { ascending: false }).order("created_at", { ascending: false }).limit(100),
    editor ? companyPeople(supabase, company.id) : Promise.resolve([]),
    supabase.from("deliveries").select("id, number, status, planned_date, vehicle, client:clients(name)").eq("company_id", company.id).not("vehicle", "is", null).order("created_at", { ascending: false }).limit(300),
  ]);
  const logs = (logData ?? []) as Log[];
  const trips = ((tripData ?? []) as unknown as Trip[]).filter((t) => plateKey(t.vehicle) === plateKey(vehicle.plate)).slice(0, 15);
  const names = await namesFor(supabase, [vehicle.driver_id, ...logs.map((l) => l.created_by)]);
  const drivers = [...people.filter((p) => p.role === "driver"), ...people.filter((p) => p.role !== "driver")];
  const due = vehicle.active ? dueSoon(vehicle) : [];
  const base = company.base_currency;

  // The last 90 days: fuel, money spent and cost per kilometre.
  const since = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
  const recent = logs.filter((l) => l.happened_on >= since);
  const litres = recent.filter((l) => l.kind === "fuel").reduce((s, l) => s + Number(l.litres ?? 0), 0);
  const spent = recent.reduce((s, l) => s + Number(l.amount ?? 0), 0);
  const kms = recent.map((l) => l.odometer_km).filter((k): k is number => k != null);
  const span = kms.length > 1 ? Math.max(...kms) - Math.min(...kms) : 0;
  const kinds = editor ? Object.keys(LOG_KINDS) : DRIVER_LOG_KINDS;

  return (
    <>
      <p className="small">
        <Link href="/fleet">{tr("← Vehicles")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{vehicle.plate}</h1>
        {!vehicle.active && <span className="badge tone-off">{tr("Off the road")}</span>}
      </div>
      <p className="muted small">
        {vehicle.name && `${vehicle.name} · `}
        {tr(VEHICLE_KINDS[vehicle.kind] ?? vehicle.kind)}
        {vehicle.capacity_kg != null && ` · ${Number(vehicle.capacity_kg).toLocaleString("en-GB")} kg`}
        {vehicle.driver_id && names.get(vehicle.driver_id) && ` · ${tr("driver")} ${names.get(vehicle.driver_id)}`}
        {vehicle.odometer_km != null && ` · ${vehicle.odometer_km.toLocaleString("en-GB")} km`}
      </p>
      <Notice {...notice} />
      {due.map((d) => (
        <p key={d.label + d.on} className={`banner small ${d.days < 0 ? "bad" : "warn"}`}>
          {tr(d.label)}: {d.on ? `${d.days < 0 ? tr("passed on") : tr("due")} ${formatDate(d.on)}` : tr("due by the kilometres")}
        </p>
      ))}
      <p className="small">
        {tr("Insurance")}: {vehicle.insurance_expires ? formatDate(vehicle.insurance_expires) : "—"} · {tr("Inspection")}:{" "}
        {vehicle.inspection_expires ? formatDate(vehicle.inspection_expires) : "—"} · {tr("Next service")}:{" "}
        {vehicle.service_due_on ? formatDate(vehicle.service_due_on) : "—"}
        {vehicle.service_due_km != null && ` / ${vehicle.service_due_km.toLocaleString("en-GB")} km`}
      </p>

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{Math.round(litres)} L</div>
          <div className="l">{tr("Fuel, last 90 days")}</div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(spent, base)}</div>
          <div className="l">{tr("Spent, last 90 days")}</div>
        </div>
        <div className="stat">
          <div className="n">{span > 0 ? formatMoney(spent / span, base) : "—"}</div>
          <div className="l">{tr("Cost per km")}</div>
        </div>
      </div>

      {can(role, "logFleet") && (
        <form action={addVehicleLog} className="card" id="log">
          <h2>{tr("Add to the log")}</h2>
          <input type="hidden" name="vehicle_id" value={vehicle.id} />
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="kind">{tr("What")}</label>
              <select id="kind" name="kind" defaultValue="fuel">
                {kinds.map((k) => (
                  <option key={k} value={k}>
                    {tr(LOG_KINDS[k])}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="happened_on">{tr("Date")}</label>
              <input id="happened_on" name="happened_on" type="date" defaultValue={todayTz()} max={todayTz()} />
            </div>
            <div className="field">
              <label htmlFor="odometer_km">{tr("Kilometres reading")}</label>
              <input id="odometer_km" name="odometer_km" type="text" inputMode="numeric" />
            </div>
            <div className="field">
              <label htmlFor="litres">{tr("Litres")}</label>
              <input id="litres" name="litres" type="text" inputMode="decimal" />
            </div>
            <div className="field">
              <label htmlFor="amount">
                {tr("Amount paid")} ({base})
              </label>
              <input id="amount" name="amount" type="text" inputMode="decimal" />
            </div>
            <div className="field">
              <label htmlFor="note">{tr("Note")}</label>
              <input id="note" name="note" type="text" maxLength={500} placeholder={tr("e.g. Puma Nyerere Road")} />
            </div>
          </div>
          <SubmitButton className="btn btn-small">{tr("Save in the log")}</SubmitButton>
        </form>
      )}

      <section className="card">
        <h2>{tr("Log")}</h2>
        {logs.length === 0 ? (
          <p className="muted small">{tr("Nothing logged yet.")}</p>
        ) : (
          <ul className="lines">
            {logs.map((l) => (
              <li key={l.id}>
                <div className="line-head">
                  <div>
                    <div className="desc">
                      {tr(LOG_KINDS[l.kind] ?? l.kind)} · {formatDate(l.happened_on)}
                    </div>
                    <div className="muted small">
                      {l.odometer_km != null && `${l.odometer_km.toLocaleString("en-GB")} km · `}
                      {l.litres != null && `${Number(l.litres)} L · `}
                      {l.note && `${l.note} · `}
                      {l.created_by && names.get(l.created_by)}
                    </div>
                  </div>
                  <strong style={{ whiteSpace: "nowrap" }}>{l.amount != null ? formatMoney(l.amount, base) : ""}</strong>
                </div>
                {(l.created_by === user.id || role === "management") && (
                  <form action={removeVehicleLog}>
                    <input type="hidden" name="vehicle_id" value={vehicle.id} />
                    <input type="hidden" name="log_id" value={l.id} />
                    <button type="submit" className="btn btn-small">
                      {tr("Remove")}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card">
        <h2>{tr("Deliveries with this vehicle")}</h2>
        {trips.length === 0 ? (
          <p className="muted small">{tr("None yet. Delivery notes with this plate in the vehicle box show here.")}</p>
        ) : (
          <ul className="rec-list">
            {trips.map((t) => (
              <li key={t.id}>
                <Link href={`/deliveries/${t.id}`}>
                  <div className="main">
                    <div className="title">{t.client?.name}</div>
                    <div className="sub">
                      {t.number}
                      {t.planned_date && ` · ${formatDate(t.planned_date)}`}
                    </div>
                  </div>
                  <div className="side">
                    <StatusBadge map={DELIVERY_STATUS} status={t.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editor && (
        <details className="card">
          <summary>{tr("Change details")}</summary>
          <form action={saveVehicle} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={vehicle.id} />
            <VehicleFields v={vehicle} drivers={drivers} editing />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
