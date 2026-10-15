import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { clientOptions, productOptions } from "@/lib/options";
import { StatusBadge } from "@/lib/sales";
import { CONTRACT_STATUS, FREQUENCIES, JOB_STATUS, canPlanService, canSeeAllService, formatWhen } from "@/lib/services";
import { saveEquipment, setEquipmentActive } from "../actions";
import { equipmentBadges } from "../badges";
import { EquipmentFields, type Equipment } from "../EquipmentFields";

export const metadata = { title: "Equipment" };

type Job = { id: string; number: string; title: string; status: string; scheduled_for: string | null; completed_at: string | null; created_at: string };
type ContractRow = { id: string; number: string; title: string; frequency: string; next_visit_on: string | null; price: number | null; currency: string; status: string };

export default async function EquipmentDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  const { data: row, error } = await supabase
    .from("client_equipment")
    .select("*, client:clients(name), product:products(name, sku)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Equipment" />;
  if (!row) notFound();
  const e = row as unknown as Equipment & { client: { name: string } | null; product: { name: string; sku: string } | null };
  const editor = canPlanService(role);

  const [{ data: jobData }, { data: contractData }, clients, products] = await Promise.all([
    supabase
      .from("service_jobs")
      .select("id, number, title, status, scheduled_for, completed_at, created_at")
      .eq("company_id", company.id)
      .eq("equipment_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    canSeeAllService(role)
      ? supabase
          .from("service_contracts")
          .select("id, number, title, frequency, next_visit_on, price, currency, status")
          .eq("company_id", company.id)
          .eq("equipment_id", id)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    editor ? clientOptions(supabase, company.id) : Promise.resolve([]),
    editor ? productOptions(supabase, company.id) : Promise.resolve([]),
  ]);
  const jobs = (jobData ?? []) as Job[];
  const contracts = (contractData ?? []) as ContractRow[];
  const badges = equipmentBadges(e);

  return (
    <>
      <p className="small">
        <Link href={`/equipment?client=${e.client_id}`}>{tr("← Equipment")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{e.name}</h1>
        {badges.map((b) => (
          <span key={b.label} className={`badge tone-${b.tone}`}>
            {tr(b.label)}
          </span>
        ))}
      </div>
      <p className="muted small">
        <Link href={`/clients/${e.client_id}`}>{e.client?.name ?? tr("Client")}</Link>
        {e.serial_no && ` · ${tr("S/N")} ${e.serial_no}`}
      </p>
      <Notice {...notice} />

      {editor && e.active && (
        <div className="actions-bar">
          <Link href={`/jobs/new?client=${e.client_id}&equipment=${e.id}`} className="btn btn-primary btn-small">
            {tr("New job for this equipment")}
          </Link>
        </div>
      )}

      <section className="card">
        <dl className="kv">
          {e.product && (
            <>
              <dt>{tr("Product")}</dt>
              <dd>
                {e.product.name}
                {e.product.sku ? ` · ${e.product.sku}` : ""}
              </dd>
            </>
          )}
          <dt>{tr("Location")}</dt>
          <dd>{e.location ?? "—"}</dd>
          <dt>{tr("Installed on")}</dt>
          <dd>{e.installed_on ? formatDate(e.installed_on) : "—"}</dd>
          <dt>{tr("Warranty until")}</dt>
          <dd>{e.warranty_until ? formatDate(e.warranty_until) : "—"}</dd>
          <dt>{tr("Service every (months)")}</dt>
          <dd>{e.service_every_months ?? "—"}</dd>
          <dt>{tr("Last service")}</dt>
          <dd>{e.last_service_on ? formatDate(e.last_service_on) : "—"}</dd>
          <dt>{tr("Next service")}</dt>
          <dd>{e.next_service_on ? formatDate(e.next_service_on) : "—"}</dd>
          {e.notes && (
            <>
              <dt>{tr("Notes")}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{e.notes}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="card">
        <h2>{tr("Service history")}</h2>
        {jobs.length === 0 ? (
          <p className="muted small">{tr("No jobs on this equipment yet.")}</p>
        ) : (
          <ul className="rec-list">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href={`/jobs/${j.id}`}>
                  <div className="main">
                    <div className="title">
                      {j.number} <span className="muted">· {j.title}</span>
                    </div>
                    <div className="sub">
                      {j.completed_at
                        ? `${tr("Completed")} ${formatWhen(j.completed_at)}`
                        : j.scheduled_for
                          ? formatWhen(j.scheduled_for)
                          : formatDate(j.created_at)}
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

      {canSeeAllService(role) && (
        <section className="card">
          <h2>{tr("Maintenance contracts")}</h2>
          {contracts.length === 0 ? (
            <p className="muted small">{tr("No maintenance contract covers this equipment.")}</p>
          ) : (
            <ul className="rec-list">
              {contracts.map((c) => (
                <li key={c.id}>
                  <Link href={`/maintenance/${c.id}`}>
                    <div className="main">
                      <div className="title">
                        {c.number} <span className="muted">· {c.title}</span>
                      </div>
                      <div className="sub">
                        {tr(FREQUENCIES[c.frequency] ?? c.frequency)}
                        {c.price != null && ` · ${formatMoney(c.price, c.currency)}`}
                        {c.status === "active" && c.next_visit_on && ` · ${tr("Next visit")} ${formatDate(c.next_visit_on)}`}
                      </div>
                    </div>
                    <div className="side">
                      <StatusBadge map={CONTRACT_STATUS} status={c.status} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {editor && (
        <>
          <details className="card">
            <summary>
              <strong>{tr("Edit equipment")}</strong>
            </summary>
            <form action={saveEquipment} style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={e.id} />
              <EquipmentFields e={e} clients={clients} products={products} />
              <SubmitButton>{tr("Save")}</SubmitButton>
            </form>
          </details>
          <form action={setEquipmentActive} className="actions-bar">
            <input type="hidden" name="id" value={e.id} />
            <input type="hidden" name="active" value={e.active ? "false" : "true"} />
            <SubmitButton className="btn btn-small">{e.active ? tr("Mark as no longer in use") : tr("Mark as in use again")}</SubmitButton>
          </form>
        </>
      )}
    </>
  );
}
