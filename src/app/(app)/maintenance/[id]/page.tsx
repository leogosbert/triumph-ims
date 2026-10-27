import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { StatusBadge } from "@/lib/sales";
import { CONTRACT_STATUS, FREQUENCIES, JOB_STATUS, canSeeAllService, formatWhen, parseChecklist, todayTz } from "@/lib/services";
import { saveContract, setContractStatus } from "../actions";
import { ContractFields, type EquipmentOption } from "../ContractFields";
import { canKeepContracts, type Contract } from "../rules";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Maintenance contract" };

type Job = { id: string; number: string; title: string; status: string; scheduled_for: string | null; created_at: string };

function StatusButton({ id, status, label, className = "btn btn-small" }: { id: string; status: string; label: string; className?: string }) {
  return (
    <form action={setContractStatus}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton className={className}>{tr(label)}</SubmitButton>
    </form>
  );
}

export default async function ContractPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!canSeeAllService(role)) redirect("/");
  const { data: row, error } = await supabase
    .from("service_contracts")
    .select("*, client:clients(name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Maintenance contract" />;
  if (!row) notFound();
  const c = row as unknown as Contract & { client: { name: string } | null };
  const editor = canKeepContracts(role);

  const [{ data: jobData }, { data: eqData }] = await Promise.all([
    supabase
      .from("service_jobs")
      .select("id, number, title, status, scheduled_for, created_at")
      .eq("company_id", company.id)
      .eq("contract_id", id)
      .order("scheduled_for", { ascending: false, nullsFirst: false })
      .limit(200),
    supabase
      .from("client_equipment")
      .select("id, name, serial_no, client_id, active, client:clients(name)")
      .eq("company_id", company.id)
      .eq("client_id", c.client_id)
      .order("name")
      .limit(500),
  ]);
  const jobs = (jobData ?? []) as Job[];
  const allEquipment = (eqData ?? []) as unknown as (EquipmentOption & { active: boolean })[];
  const equipment = allEquipment.find((e) => e.id === c.equipment_id);
  const options = allEquipment.filter((e) => e.active || e.id === c.equipment_id);
  const checklist = parseChecklist(c.checklist);

  return (
    <>
      <BackLink href="/maintenance" label="Maintenance contracts" />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{c.title}</h1>
        <StatusBadge map={CONTRACT_STATUS} status={c.status} />
      </div>
      <p className="muted small">
        {c.number} · <Link href={`/clients/${c.client_id}`}>{c.client?.name ?? tr("Client")}</Link>
      </p>
      <Notice {...notice} />

      <section className="card">
        <dl className="kv">
          <dt>{tr("Visits")}</dt>
          <dd>{tr(FREQUENCIES[c.frequency] ?? c.frequency)}</dd>
          <dt>{tr("Period")}</dt>
          <dd>
            {formatDate(c.starts_on)} – {c.ends_on ? formatDate(c.ends_on) : tr("no end date")}
          </dd>
          <dt>{tr("Next visit")}</dt>
          <dd>{c.status === "active" && c.next_visit_on ? formatDate(c.next_visit_on) : "—"}</dd>
          <dt>{tr("Price per period")}</dt>
          <dd>{c.price != null ? formatMoney(c.price, c.currency) : "—"}</dd>
          {c.response_hours != null && (
            <>
              <dt>{tr("Response time")}</dt>
              <dd>
                {c.response_hours} {tr("hours")}
              </dd>
            </>
          )}
          {c.visit_title && (
            <>
              <dt>{tr("Visit job title")}</dt>
              <dd>{c.visit_title}</dd>
            </>
          )}
          {c.site && (
            <>
              <dt>{tr("Site")}</dt>
              <dd>{c.site}</dd>
            </>
          )}
          {c.equipment_id && (
            <>
              <dt>{tr("Equipment")}</dt>
              <dd>
                <Link href={`/equipment/${c.equipment_id}`}>
                  {equipment ? `${equipment.name}${equipment.serial_no ? ` (${equipment.serial_no})` : ""}` : tr("Open")}
                </Link>
              </dd>
            </>
          )}
          {c.notes && (
            <>
              <dt>{tr("Notes")}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{c.notes}</dd>
            </>
          )}
        </dl>
        {checklist.length > 0 && (
          <>
            <h3 className="small" style={{ marginBottom: 4 }}>
              {tr("Checklist for each visit")}
            </h3>
            <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
              {checklist.map((x, i) => (
                <li key={i}>{x.text}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      {editor && (
        <div className="actions-bar">
          {c.status === "active" && <StatusButton id={c.id} status="paused" label="Pause" />}
          {c.status === "paused" && <StatusButton id={c.id} status="active" label="Resume" className="btn btn-primary btn-small" />}
          {c.status === "ended" && <StatusButton id={c.id} status="active" label="Reopen" />}
          {c.status !== "ended" && <StatusButton id={c.id} status="ended" label="End contract" />}
        </div>
      )}
      {!editor && <p className="muted small">{tr("Only management and sales can change maintenance contracts.")}</p>}

      <section className="card">
        <h2>{tr("Visits and jobs")}</h2>
        {jobs.length === 0 ? (
          <p className="muted small">{tr("No jobs yet. Use Plan due visits on the contracts list to create them.")}</p>
        ) : (
          <ul className="rec-list">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/jobs/${j.id}`}>
                  <div className="main">
                    <div className="title">{j.number}</div>
                    <div className="sub">
                      {j.scheduled_for ? formatWhen(j.scheduled_for) : formatDate(j.created_at)} · {j.title}
                    </div>
                  </div>
                  <div className="side">
                    <StatusBadge map={JOB_STATUS} status={j.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editor && (
        <details className="card">
          <summary>
            <strong>{tr("Edit contract")}</strong>
          </summary>
          <form action={saveContract} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={c.id} />
            <ContractFields c={c} equipment={options} currency={company.base_currency} today={todayTz()} />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
