import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CorrectiveActions } from "@/components/CorrectiveActions";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { INSPECTION_KINDS, INSPECTION_RESULTS, withCurrent, type Inspection } from "@/lib/hse";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { StatusBadge } from "@/lib/sales";
import { saveInspection } from "../../actions";
import { linkedNames, loadLinkOptions } from "../../options";
import { InspectionFields } from "../InspectionFields";
import { BackLink } from "@/components/BackLink";
import { hasRole } from "@/lib/roles";

export const metadata = { title: "Inspection" };

export default async function InspectionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, user } = await getAppContext();
  const { data, error } = await supabase.from("hse_inspections").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Inspection" />;
  if (!data) notFound();
  const insp = data as Inspection;
  const editor = hasRole(roles, "management") || insp.inspector_id === user.id;
  const [linked, names, options] = await Promise.all([
    linkedNames(supabase, insp),
    namesFor(supabase, [insp.inspector_id]),
    editor ? loadLinkOptions(supabase, company.id, false) : Promise.resolve(null),
  ]);
  const links = [
    { href: `/projects/${insp.project_id}`, label: "Project", name: insp.project_id ? linked.project : null },
    { href: `/jobs/${insp.job_id}`, label: "Service job", name: insp.job_id ? linked.job : null },
    { href: `/fleet/${insp.vehicle_id}`, label: "Vehicle", name: insp.vehicle_id ? linked.vehicle : null },
  ];
  const kind = tr(INSPECTION_KINDS[insp.kind] ?? insp.kind);

  return (
    <>
      <BackLink href="/hse?tab=inspections" label="Health & safety" />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{insp.topic || kind}</h1>
        <StatusBadge map={INSPECTION_RESULTS} status={insp.result} />
      </div>
      <p className="muted small">
        {insp.number} · {kind} · {formatDate(insp.inspected_on)}
        {insp.site && ` · ${insp.site}`} · {names.get(insp.inspector_id) ?? "—"}
      </p>
      <Notice {...notice} />

      <section className="card">
        {insp.findings ? <p style={{ whiteSpace: "pre-wrap" }}>{insp.findings}</p> : <p className="muted small">{tr("No findings written.")}</p>}
        {(insp.attendees || insp.attendee_count != null) && (
          <p className="small" style={{ whiteSpace: "pre-wrap" }}>
            <strong>{tr("Attendees")}</strong>
            {insp.attendee_count != null && ` (${insp.attendee_count})`}: {insp.attendees}
          </p>
        )}
        {links
          .filter((l) => l.name)
          .map((l) => (
            <p key={l.label} className="small">
              <strong>{tr(l.label)}:</strong> <Link href={l.href}>{l.name}</Link>
            </p>
          ))}
      </section>

      <CorrectiveActions sourceKind="inspection" sourceId={insp.id} />

      {editor && options && (
        <details className="card">
          <summary>{tr("Change details")}</summary>
          <form action={saveInspection} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={insp.id} />
            <InspectionFields
              v={insp}
              options={{
                projects: withCurrent(options.projects, insp.project_id, linked.project),
                jobs: withCurrent(options.jobs, insp.job_id, linked.job),
                vehicles: withCurrent(options.vehicles, insp.vehicle_id, linked.vehicle),
              }}
            />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
