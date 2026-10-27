import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import {
  ACTION_STATUS,
  INCIDENT_KINDS,
  INCIDENT_STATUS,
  INSPECTION_KINDS,
  INSPECTION_RESULTS,
  SEVERITIES,
  SOURCE_KIND_LABEL,
  sourcePath,
  type CorrectiveAction,
} from "@/lib/hse";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { StatusBadge } from "@/lib/sales";
import { daysFromToday, formatWhen } from "@/lib/services";
import { hasRole } from "@/lib/roles";

export const metadata = { title: "Health & safety" };

type IncidentRow = { id: string; number: string; title: string; kind: string; site: string | null; occurred_at: string; severity: string; status: string };
type InspectionRow = { id: string; number: string; inspected_on: string; kind: string; site: string | null; topic: string | null; result: string; inspector_id: string };
type Summary = { manager?: boolean; incidents_open?: number; incidents_serious_open?: number; days_since_injury?: number | null; actions_overdue?: number };

const TABS = [
  { key: "incidents", label: "Incidents" },
  { key: "inspections", label: "Inspections" },
  { key: "actions", label: "Actions" },
];

export default async function HsePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, user } = await getAppContext();
  const manager = hasRole(roles, "management");
  const tab = TABS.some((t) => t.key === sp.tab) ? String(sp.tab) : "incidents";

  const probe = await supabase.from("hse_incidents").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="Health & safety" />;

  const summary: Summary = manager ? (((await supabase.rpc("admin_summary", { p_company: company.id })).data ?? {}) as Summary) : {};

  let body: React.ReactNode = null;
  if (tab === "incidents") {
    const { data } = await supabase
      .from("hse_incidents")
      .select("id, number, title, kind, site, occurred_at, severity, status")
      .eq("company_id", company.id)
      .order("occurred_at", { ascending: false })
      .limit(200);
    const rows = (data ?? []) as IncidentRow[];
    body = (
      <>
        {!manager && <h2>{tr("Incidents you reported")}</h2>}
        {rows.length === 0 ? (
          <p className="card muted">{tr("No incidents reported. Report every accident and near miss so it can be prevented next time.")}</p>
        ) : (
          <ul className="rec-list">
            {rows.map((r) => (
              <li key={r.id}>
                <Link href={`/hse/${r.id}`}>
                  <div className="main">
                    <div className="title">
                      {r.number} · {r.title}
                    </div>
                    <div className="sub">
                      {tr(INCIDENT_KINDS[r.kind] ?? r.kind)}
                      {r.site && ` · ${r.site}`} · {formatWhen(r.occurred_at)}
                    </div>
                  </div>
                  <div className="side" style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <StatusBadge map={SEVERITIES} status={r.severity} />
                    <StatusBadge map={INCIDENT_STATUS} status={r.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  } else if (tab === "inspections") {
    const { data } = await supabase
      .from("hse_inspections")
      .select("id, number, inspected_on, kind, site, topic, result, inspector_id")
      .eq("company_id", company.id)
      .order("inspected_on", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);
    const rows = (data ?? []) as InspectionRow[];
    const names = await namesFor(supabase, rows.map((r) => r.inspector_id));
    body = (
      <>
        {!manager && <h2>{tr("Inspections you recorded")}</h2>}
        {rows.length === 0 ? (
          <p className="card muted">{tr("No inspections or toolbox talks recorded yet.")}</p>
        ) : (
          <ul className="rec-list">
            {rows.map((r) => {
              const kind = tr(INSPECTION_KINDS[r.kind] ?? r.kind);
              return (
                <li key={r.id}>
                  <Link href={`/hse/inspections/${r.id}`}>
                    <div className="main">
                      <div className="title">
                        {r.number} · {r.topic || kind}
                      </div>
                      <div className="sub">
                        {r.topic && `${kind} · `}
                        {r.site && `${r.site} · `}
                        {formatDate(r.inspected_on)}
                        {names.get(r.inspector_id) && ` · ${names.get(r.inspector_id)}`}
                      </div>
                    </div>
                    <div className="side">
                      <StatusBadge map={INSPECTION_RESULTS} status={r.result} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </>
    );
  } else {
    let q = supabase
      .from("corrective_actions")
      .select("id, source_kind, source_id, action, owner_id, due_on, status, done_note, done_by, done_at, created_at")
      .eq("company_id", company.id)
      .eq("status", "open")
      .order("due_on", { ascending: true, nullsFirst: false })
      .order("created_at")
      .limit(300);
    if (!manager) q = q.eq("owner_id", user.id);
    const { data } = await q;
    const rows = (data ?? []) as CorrectiveAction[];
    const ids = (k: string) => rows.filter((r) => r.source_kind === k).map((r) => r.source_id);
    const [names, inc, insp, ncr] = await Promise.all([
      namesFor(supabase, rows.map((r) => r.owner_id)),
      ids("incident").length ? supabase.from("hse_incidents").select("id, number, title").in("id", ids("incident")) : Promise.resolve({ data: [] }),
      ids("inspection").length ? supabase.from("hse_inspections").select("id, number, topic").in("id", ids("inspection")) : Promise.resolve({ data: [] }),
      ids("ncr").length ? supabase.from("quality_ncrs").select("id, number, title").in("id", ids("ncr")) : Promise.resolve({ data: [] }),
    ]);
    const label = new Map<string, string>();
    for (const r of [...(inc.data ?? []), ...(insp.data ?? []), ...(ncr.data ?? [])] as Record<string, string | null>[]) {
      label.set(r.id!, [r.number, r.title ?? r.topic].filter(Boolean).join(" · "));
    }
    body = (
      <>
        <h2>{manager ? tr("Open actions") : tr("Actions for you")}</h2>
        {rows.length === 0 ? (
          <p className="card muted">{tr("No open actions.")}</p>
        ) : (
          <ul className="rec-list">
            {rows.map((a) => {
              const days = daysFromToday(a.due_on);
              return (
                <li key={a.id}>
                  <Link href={`${sourcePath(a.source_kind, a.source_id)}#actions`}>
                    <div className="main">
                      <div className="title">{a.action}</div>
                      <div className="sub">
                        {label.get(a.source_id) ?? tr(SOURCE_KIND_LABEL[a.source_kind] ?? a.source_kind)}
                        {manager && ` · ${a.owner_id ? names.get(a.owner_id) ?? "—" : tr("No owner")}`}
                      </div>
                    </div>
                    <div className="side" style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                      {a.due_on ? (
                        <span className={`badge ${days !== null && days < 0 ? "tone-bad" : days !== null && days <= 3 ? "tone-warn" : "tone-off"}`}>
                          {days !== null && days < 0 ? tr("Overdue") : tr("due")} {formatDate(a.due_on)}
                        </span>
                      ) : (
                        <StatusBadge map={ACTION_STATUS} status={a.status} />
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

  return (
    <>
      <div className="page-head">
        <h1>{tr("Health & safety")}</h1>
      </div>
      <Notice {...notice} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
        <Link href="/hse/new" className="btn btn-primary" style={{ flex: "1 1 220px", textAlign: "center", padding: "14px 16px", fontSize: "1.05rem" }}>
          {tr("Report incident")}
        </Link>
        <Link href="/hse/inspections/new" className="btn" style={{ flex: "1 1 220px", textAlign: "center", padding: "14px 16px" }}>
          {tr("Record inspection / toolbox talk")}
        </Link>
      </div>
      {manager && (
        <div className="stat-grid">
          <div className="stat">
            <div className="n">{summary.incidents_open ?? 0}</div>
            <div className="l">{tr("Open incidents")}</div>
          </div>
          <div className={`stat ${summary.incidents_serious_open ? "alert" : ""}`}>
            <div className="n">{summary.incidents_serious_open ?? 0}</div>
            <div className="l">{tr("Serious, still open")}</div>
          </div>
          <div className="stat">
            <div className="n">{summary.days_since_injury ?? "—"}</div>
            <div className="l">{tr("Days since the last injury")}</div>
          </div>
          <div className={`stat ${summary.actions_overdue ? "alert" : ""}`}>
            <div className="n">{summary.actions_overdue ?? 0}</div>
            <div className="l">{tr("Overdue actions")}</div>
          </div>
        </div>
      )}
      <nav className="tabs-row" aria-label={tr("Show")}>
        {TABS.map((t) => (
          <Link key={t.key} href={t.key === "incidents" ? "/hse" : `/hse?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined}>
            {tr(t.label)}
          </Link>
        ))}
      </nav>
      {body}
    </>
  );
}
