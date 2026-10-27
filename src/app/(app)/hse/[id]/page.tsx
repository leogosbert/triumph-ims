import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CorrectiveActions } from "@/components/CorrectiveActions";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { INCIDENT_KINDS, INCIDENT_STATUS, SEVERITIES, withCurrent, type Incident } from "@/lib/hse";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { StatusBadge } from "@/lib/sales";
import { formatWhen } from "@/lib/services";
import { saveIncident, setRecordStatus } from "../actions";
import { IncidentFields } from "../IncidentFields";
import { linkedNames, loadLinkOptions } from "../options";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Incident" };

function StatusButton({ id, status, label, primary = false }: { id: string; status: string; label: string; primary?: boolean }) {
  return (
    <form action={setRecordStatus}>
      <input type="hidden" name="kind" value="incident" />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton className={`btn btn-small${primary ? " btn-primary" : ""}`}>{tr(label)}</SubmitButton>
    </form>
  );
}

export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  const { data, error } = await supabase.from("hse_incidents").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Incident" />;
  if (!data) notFound();
  const inc = data as Incident;
  const manager = role === "management";
  const [linked, names, options] = await Promise.all([
    linkedNames(supabase, inc),
    namesFor(supabase, [inc.reported_by, inc.closed_by]),
    manager ? loadLinkOptions(supabase, company.id, true) : Promise.resolve(null),
  ]);
  const sev = SEVERITIES[inc.severity];
  const links: { href: string; label: string; name: string | null }[] = [
    { href: `/clients/${inc.client_id}`, label: "Client", name: inc.client_id ? linked.client : null },
    { href: `/projects/${inc.project_id}`, label: "Project", name: inc.project_id ? linked.project : null },
    { href: `/jobs/${inc.job_id}`, label: "Service job", name: inc.job_id ? linked.job : null },
    { href: `/fleet/${inc.vehicle_id}`, label: "Vehicle", name: inc.vehicle_id ? linked.vehicle : null },
  ];

  return (
    <>
      <BackLink href="/hse" label="Health & safety" />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{inc.title}</h1>
        <StatusBadge map={INCIDENT_STATUS} status={inc.status} />
      </div>
      <p className="muted small">
        {inc.number} · {tr(INCIDENT_KINDS[inc.kind] ?? inc.kind)} · {formatWhen(inc.occurred_at)}
        {inc.site && ` · ${inc.site}`} · {tr("reported by")} {names.get(inc.reported_by) ?? "—"}
      </p>
      <Notice {...notice} />
      <p>
        <span className={`badge tone-${sev?.tone ?? "off"}`}>{tr(sev?.label ?? inc.severity)}</span>
        {inc.reportable && <span className="badge tone-bad" style={{ marginLeft: 6 }}>{tr("Reportable to OSHA")}</span>}
        {Number(inc.lost_days) > 0 && (
          <span className="small" style={{ marginLeft: 6 }}>
            {tr("Days lost")}: {Number(inc.lost_days)}
          </span>
        )}
      </p>

      {manager && (
        <div className="actions-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {inc.status === "open" && <StatusButton id={inc.id} status="investigating" label="Start investigation" primary />}
          {inc.status !== "closed" && <StatusButton id={inc.id} status="closed" label="Close" />}
          {inc.status === "closed" && <StatusButton id={inc.id} status="open" label="Reopen" />}
        </div>
      )}

      <section className="card">
        <h2>{tr("What happened")}</h2>
        <p style={{ whiteSpace: "pre-wrap" }}>{inc.description}</p>
        {inc.people_involved && (
          <p className="small">
            <strong>{tr("People involved")}:</strong> {inc.people_involved}
          </p>
        )}
        {linked.employee && (
          <p className="small">
            <strong>{tr("Employee involved")}:</strong> {linked.employee}
          </p>
        )}
        {inc.immediate_action && (
          <p className="small" style={{ whiteSpace: "pre-wrap" }}>
            <strong>{tr("Immediate action taken")}:</strong> {inc.immediate_action}
          </p>
        )}
        {inc.root_cause && (
          <p className="small" style={{ whiteSpace: "pre-wrap" }}>
            <strong>{tr("Root cause")}:</strong> {inc.root_cause}
          </p>
        )}
        {links
          .filter((l) => l.name)
          .map((l) => (
            <p key={l.label} className="small">
              <strong>{tr(l.label)}:</strong> <Link href={l.href}>{l.name}</Link>
            </p>
          ))}
        {inc.closed_at && (
          <p className="muted small">
            {tr("Closed")} {formatWhen(inc.closed_at)}
            {inc.closed_by && ` · ${names.get(inc.closed_by) ?? ""}`}
          </p>
        )}
      </section>

      <CorrectiveActions sourceKind="incident" sourceId={inc.id} closed={inc.status === "closed"} />

      {manager && options && (
        <details className="card">
          <summary>{tr("Investigation and details")}</summary>
          <form action={saveIncident} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={inc.id} />
            <IncidentFields
              v={inc}
              investigation
              options={{
                employees: withCurrent(options.employees, inc.employee_id, linked.employee),
                clients: withCurrent(options.clients, inc.client_id, linked.client),
                projects: withCurrent(options.projects, inc.project_id, linked.project),
                jobs: withCurrent(options.jobs, inc.job_id, linked.job),
                vehicles: withCurrent(options.vehicles, inc.vehicle_id, linked.vehicle),
              }}
            />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
