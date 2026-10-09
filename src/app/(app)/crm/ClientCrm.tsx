import { tr } from "@/lib/tr";
import Link from "next/link";
import { SubmitButton } from "@/components/SubmitButton";
import { DATE_KINDS, OPP_BADGE, dateKindLabel, daysUntil } from "@/lib/crm";
import type { Features } from "@/lib/features";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { can, type Role } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import type { createClient } from "@/lib/supabase/server";
import { addImportantDate, deleteImportantDate } from "./actions";
import { ActivityForm, type ActivityRow } from "./ActivityForm";
import { Timeline } from "./Timeline";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Next time a date comes round (same rule as the database's next_occurrence). */
function nextOccurrence(date: string, yearly: boolean): string {
  if (!yearly) return date;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Dar_es_Salaam",
  }).format(new Date());
  const [, m, d] = date.split("-").map(Number);
  const make = (y: number) => {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
  };
  const y = Number(today.slice(0, 4));
  return make(y) >= today ? make(y) : make(y + 1);
}

/**
 * The sales side of a client (Stage 14): opportunities, contracts, important dates and the history of
 * calls and visits. Shows nothing before the Stage 14 SQL or for roles outside sales and management.
 */
export async function ClientCrm({
  supabase,
  companyId,
  clientId,
  role,
  features,
}: {
  supabase: Supabase;
  companyId: string;
  clientId: string;
  role: Role;
  features: Features;
}) {
  if (!can(role, "seeCrm")) return null;
  const [opps, dates, acts, contracts] = await Promise.all([
    supabase
      .from("opportunities")
      .select("id, number, title, stage, value, currency, next_on, next_action")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("important_dates")
      .select("id, title, kind, the_date, yearly, remind_days")
      .eq("client_id", clientId)
      .limit(100),
    supabase
      .from("crm_activities")
      .select(
        "id, kind, happened_on, summary, location, next_action, next_on, created_by, opportunity_id",
      )
      .eq("client_id", clientId)
      .order("happened_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("contracts")
      .select("id, number, title, end_date, cancelled_at")
      .eq("client_id", clientId)
      .order("end_date", { ascending: false })
      .limit(20),
  ]);
  if (opps.error) return null;
  const oppRows = (opps.data ?? []) as {
    id: string;
    number: string;
    title: string;
    stage: string;
    value: number;
    currency: string;
    next_on: string | null;
    next_action: string | null;
  }[];
  const activities = (acts.data ?? []) as ActivityRow[];
  const names = await namesFor(
    supabase,
    activities.map((a) => a.created_by),
  );
  const oppTitles = new Map(oppRows.map((o) => [o.id, o.title]));
  const dateRows = (
    (dates.data ?? []) as {
      id: string;
      title: string;
      kind: string;
      the_date: string;
      yearly: boolean;
      remind_days: number;
    }[]
  )
    .map((d) => ({ ...d, next: nextOccurrence(d.the_date, d.yearly) }))
    .sort((a, b) => a.next.localeCompare(b.next));
  const contractRows = (contracts.data ?? []) as {
    id: string;
    number: string;
    title: string;
    end_date: string;
    cancelled_at: string | null;
  }[];
  const showPipeline = features.on("crm_pipeline");

  return (
    <>
      {showPipeline && (
        <section className="card" id="opportunities">
          <div className="page-head" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>{tr("Opportunities")}</h2>
            <Link
              href={`/crm/new?client=${clientId}`}
              className="btn btn-small"
            >
              {tr("+ Opportunity")}
            </Link>
          </div>
          {oppRows.length === 0 ? (
            <p className="muted small">
              {tr("No opportunities with this client yet.")}
            </p>
          ) : (
            <ul className="list">
              {oppRows.map((o) => (
                <li key={o.id} className="row">
                  <Link href={`/crm/${o.id}`}>{o.title}</Link>
                  <span className="small">
                    {formatMoney(o.value, o.currency)}{" "}
                    <StatusBadge map={OPP_BADGE} status={o.stage} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {features.on("contracts") && contractRows.length > 0 && (
        <section className="card" id="contracts">
          <h2>{tr("Contracts")}</h2>
          <ul className="list">
            {contractRows.map((k) => {
              const left = daysUntil(k.end_date) ?? 0;
              return (
                <li key={k.id} className="row">
                  <Link href={`/contracts/${k.id}`}>
                    {k.number} · {k.title}
                  </Link>
                  <span className="small muted">
                    {k.cancelled_at
                      ? tr("Ended early")
                      : left < 0
                        ? tr("Ended")
                        : `${tr("until")} ${formatDate(k.end_date)}`}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {showPipeline && (
        <section className="card" id="dates">
          <h2>{tr("Important dates")}</h2>
          {dateRows.length === 0 ? (
            <p className="muted small">
              {tr(
                "Birthdays, company anniversaries and renewal dates. You are reminded a few days before.",
              )}
            </p>
          ) : (
            <ul className="list">
              {dateRows.map((d) => {
                const left = daysUntil(d.next) ?? 999;
                return (
                  <li key={d.id} className="row">
                    <span>
                      {d.title}{" "}
                      <span className="small muted">
                        · {tr(dateKindLabel(d.kind))}
                      </span>
                    </span>
                    <span
                      className="small"
                      style={{ display: "flex", gap: 6, alignItems: "center" }}
                    >
                      <span
                        className={
                          left >= 0 && left <= d.remind_days
                            ? "text-warn"
                            : undefined
                        }
                      >
                        {formatDate(d.next)}
                        {d.yearly && " ↻"}
                      </span>
                      <form action={deleteImportantDate}>
                        <input type="hidden" name="id" value={d.id} />
                        <input
                          type="hidden"
                          name="client_id"
                          value={clientId}
                        />
                        <button
                          type="submit"
                          className="btn btn-small"
                          aria-label={tr("Remove")}
                          title={tr("Remove")}
                        >
                          ✕
                        </button>
                      </form>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <details style={{ marginTop: 8 }}>
            <summary className="small">{tr("+ Add a date")}</summary>
            <form
              action={addImportantDate}
              className="grid grid-2"
              style={{ marginTop: 8 }}
            >
              <input type="hidden" name="client_id" value={clientId} />
              <div className="field">
                <label htmlFor="d-title">{tr("What")}</label>
                <input
                  id="d-title"
                  name="title"
                  type="text"
                  required
                  minLength={2}
                  maxLength={200}
                  placeholder={tr("e.g. Procurement manager's birthday")}
                />
              </div>
              <div className="field">
                <label htmlFor="d-kind">{tr("Type")}</label>
                <select id="d-kind" name="kind" defaultValue="birthday">
                  {DATE_KINDS.map((k) => (
                    <option key={k.key} value={k.key}>
                      {tr(k.label)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="d-date">{tr("Date")}</label>
                <input id="d-date" name="the_date" type="date" required />
              </div>
              <div className="field">
                <label htmlFor="d-remind">
                  {tr("Remind me (days before)")}
                </label>
                <input
                  id="d-remind"
                  name="remind_days"
                  type="number"
                  min={0}
                  max={90}
                  defaultValue={3}
                />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label>
                  <input type="checkbox" name="yearly" defaultChecked />{" "}
                  {tr("Every year")}
                </label>
              </div>
              <SubmitButton className="btn btn-small btn-primary">
                {tr("Save date")}
              </SubmitButton>
            </form>
          </details>
        </section>
      )}

      {showPipeline && (
        <section className="card" id="history">
          <h2>{tr("Calls and visits")}</h2>
          <Timeline rows={activities} names={names} oppTitles={oppTitles} />
          <details style={{ marginTop: 8 }}>
            <summary className="small">
              {tr("+ Log a call, visit or message")}
            </summary>
            <div style={{ marginTop: 8 }}>
              <ActivityForm
                back={`/clients/${clientId}#history`}
                clientId={clientId}
              />
            </div>
          </details>
        </section>
      )}
    </>
  );
}
