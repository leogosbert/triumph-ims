import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { productOptions } from "@/lib/options";
import { companyPeople, namesFor } from "@/lib/people";
import { StatusBadge } from "@/lib/sales";
import { canInvoiceService, canPlanService, formatWhen, JOB_KINDS, JOB_PRIORITIES, JOB_STATUS, LINE_KINDS, OPEN_JOB, parseChecklist, todayTz } from "@/lib/services";
import { fmtQty, storeOptions } from "@/lib/stock";
import { addJobHours, addJobLine, invoiceJob, jobStatus, removeJobHours, removeJobLine, saveJob, saveProgress } from "../actions";
import { JobFields } from "../JobFields";
import { SignOff } from "./SignOff";
import { BackLink } from "@/components/BackLink";
import { hasRole } from "@/lib/roles";

export const metadata = { title: "Service job" };

type Line = {
  id: string;
  kind: string;
  product_id: string | null;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  posted_at: string | null;
  created_by: string | null;
};
type Hours = { id: string; user_id: string; work_date: string; hours: number; description: string | null; billable: boolean; rate: number | null; invoice_id: string | null };

export default async function JobPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, user } = await getAppContext();
  const { data: j, error } = await supabase
    .from("service_jobs")
    .select("*, client:clients(id, name), contract:service_contracts(id, number, title), equipment:client_equipment(id, name, serial_no), project:projects(id, number, name), quotation:quotations(id, number), invoice:invoices(id, number)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Service job" />;
  if (!j) notFound();

  const planner = canPlanService(roles);
  const onJob = (j.assigned_to as string[]).includes(user.id);
  const worker = planner || onJob;
  const open = OPEN_JOB.includes(j.status);
  const [{ data: lineData }, { data: hourData }, products, people, stores, { data: eqData }, { data: prjData }] = await Promise.all([
    supabase.from("service_job_lines").select("id, kind, product_id, description, quantity, unit, unit_price, posted_at, created_by").eq("job_id", id).order("created_at"),
    supabase.from("timesheets").select("id, user_id, work_date, hours, description, billable, rate, invoice_id").eq("job_id", id).order("work_date"),
    worker && open ? productOptions(supabase, company.id) : Promise.resolve([]),
    planner ? companyPeople(supabase, company.id) : Promise.resolve([]),
    planner && open ? storeOptions(supabase, company.id) : Promise.resolve([]),
    planner && open
      ? supabase.from("client_equipment").select("id, name, serial_no").eq("company_id", company.id).eq("client_id", j.client_id).eq("active", true).order("name")
      : Promise.resolve({ data: [] }),
    planner && open
      ? supabase.from("projects").select("id, number, name").eq("company_id", company.id).eq("client_id", j.client_id).eq("status", "active")
      : Promise.resolve({ data: [] }),
  ]);
  const lines = (lineData ?? []) as Line[];
  const hours = (hourData ?? []) as Hours[];
  const names = await namesFor(supabase, [...(j.assigned_to as string[]), ...hours.map((h) => h.user_id), j.created_by]);
  const checklist = parseChecklist(j.checklist);
  const ticked = checklist.filter((c) => c.done).length;
  const linesTotal = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0);
  const hoursTotal = hours.reduce((s, h) => s + Number(h.hours), 0);
  const hoursValue = hours.filter((h) => h.billable && !h.invoice_id).reduce((s, h) => s + Number(h.hours) * Number(h.rate ?? 0), 0);
  const billValue = j.price != null ? Number(j.price) : linesTotal + hoursValue;
  const team = (j.assigned_to as string[]).map((u) => names.get(u)).filter(Boolean).join(", ");
  const signatureUrl = j.signature_path ? ((await supabase.storage.from("pod").createSignedUrl(j.signature_path, 3600)).data?.signedUrl ?? null) : null;
  const late = open && !!(j.due_by ?? j.scheduled_for) && Date.parse(j.due_by ?? j.scheduled_for) < Date.now() - (j.due_by ? 0 : 86400000);
  const pr = JOB_PRIORITIES[j.priority];
  const currencies = [company.base_currency, ...(company.second_currency && company.second_currency !== company.base_currency ? [company.second_currency] : [])];

  return (
    <>
      <BackLink href="/jobs" label="Service jobs" />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{j.title}</h1>
        <span className="sj-actions">
          {late && <span className="badge tone-bad">{tr("Late")}</span>}
          <StatusBadge map={JOB_STATUS} status={j.status} />
        </span>
      </div>
      <p className="muted small">
        {j.number} · <Link href={`/clients/${j.client?.id}`}>{j.client?.name}</Link> · {tr(JOB_KINDS[j.kind] ?? j.kind)}
        {j.priority !== "normal" && pr && ` · ${tr(pr.label)}`}
        {j.scheduled_for && ` · ${formatWhen(j.scheduled_for)}`}
        {j.due_by && ` · ${tr("due")} ${formatWhen(j.due_by)}`}
      </p>
      <p className="small">
        {j.site && (
          <>
            {tr("Site")}: {j.site}
            <br />
          </>
        )}
        {j.contact && (
          <>
            {tr("Contact on site")}: {j.contact}
            <br />
          </>
        )}
        {tr("Technicians")}: {team || tr("nobody yet")}
        {j.equipment && (
          <>
            <br />
            {tr("Equipment")}: <Link href={`/equipment/${j.equipment.id}`}>{j.equipment.name}{j.equipment.serial_no ? ` (${j.equipment.serial_no})` : ""}</Link>
          </>
        )}
        {j.contract && (
          <>
            <br />
            {tr("Maintenance contract")}: <Link href={`/maintenance/${j.contract.id}`}>{j.contract.number} · {j.contract.title}</Link>
          </>
        )}
        {j.project && (
          <>
            <br />
            {tr("Project")}: <Link href={`/projects/${j.project.id}`}>{j.project.number} · {j.project.name}</Link>
          </>
        )}
        {j.quotation && (
          <>
            <br />
            {tr("Quotation")}: <Link href={`/quotations/${j.quotation.id}`}>{j.quotation.number}</Link>
          </>
        )}
        {j.invoice && (
          <>
            <br />
            {tr("Invoice")}: <Link href={`/invoices/${j.invoice.id}`}>{j.invoice.number || tr("Draft")}</Link>
          </>
        )}
      </p>
      {j.description && <p className="card small" style={{ whiteSpace: "pre-wrap" }}>{j.description}</p>}
      {j.status === "cancelled" && j.cancelled_reason && (
        <p className="banner small">
          {tr("Cancelled")}: {j.cancelled_reason}
        </p>
      )}
      <Notice {...notice} />

      {worker && open && (
        <section className="card">
          <div className="sj-actions">
            {(j.status === "scheduled" || j.status === "on_hold") && (
              <form action={jobStatus}>
                <input type="hidden" name="id" value={j.id} />
                <input type="hidden" name="status" value="in_progress" />
                <SubmitButton>{j.status === "on_hold" ? tr("Resume") : tr("Start the job")}</SubmitButton>
              </form>
            )}
            {j.status === "in_progress" && (
              <form action={jobStatus}>
                <input type="hidden" name="id" value={j.id} />
                <input type="hidden" name="status" value="on_hold" />
                <SubmitButton className="btn">{tr("Put on hold")}</SubmitButton>
              </form>
            )}
            <a href="#finish" className="btn">
              {tr("Finish and sign off")}
            </a>
          </div>
        </section>
      )}

      <section className="card" id="checklist">
        <h2>
          {tr("Checklist")}{" "}
          {checklist.length > 0 && (
            <span className="small muted">
              · {ticked}/{checklist.length}
            </span>
          )}
        </h2>
        {checklist.length > 0 && (
          <div className="sj-progress" aria-hidden="true">
            <span style={{ width: `${Math.round((ticked / checklist.length) * 100)}%` }} />
          </div>
        )}
        {worker && open ? (
          <form action={saveProgress}>
            <input type="hidden" name="id" value={j.id} />
            {checklist.length > 0 && (
              <ul className="sj-checklist">
                {checklist.map((c, i) => (
                  <li key={i}>
                    <input id={`c${i}`} type="checkbox" name="done" value={i} defaultChecked={c.done} />
                    <label htmlFor={`c${i}`} style={{ fontWeight: 400 }}>
                      {c.text}
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="field">
              <label htmlFor="add_points">{tr("Add points")}</label>
              <textarea id="add_points" name="add_points" rows={2} placeholder={tr("One per line")} />
            </div>
            <div className="field">
              <label htmlFor="findings">{tr("Findings and work done")}</label>
              <textarea id="findings" name="findings" maxLength={4000} defaultValue={j.findings ?? ""} />
            </div>
            <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
          </form>
        ) : (
          <>
            {checklist.length === 0 ? (
              <p className="muted small">{tr("No checklist.")}</p>
            ) : (
              <ul className="sj-checklist">
                {checklist.map((c, i) => (
                  <li key={i}>
                    <span aria-hidden="true">{c.done ? "✓" : "○"}</span>
                    <span className={c.done ? "done" : undefined}>{c.text}</span>
                  </li>
                ))}
              </ul>
            )}
            {j.findings && (
              <p className="small" style={{ whiteSpace: "pre-wrap" }}>
                <strong>{tr("Findings")}:</strong> {j.findings}
              </p>
            )}
          </>
        )}
      </section>

      <section className="card" id="lines">
        <h2>
          {tr("Materials and work")} <span className="small muted">· {lines.length}</span>
        </h2>
        {lines.length === 0 ? (
          <p className="muted small">{tr("Nothing yet. Add the materials used and the labour as you go.")}</p>
        ) : (
          <ul className="lines">
            {lines.map((l) => (
              <li key={l.id}>
                <div className="line-head">
                  <div>
                    <div className="desc">{l.description}</div>
                    <div className="muted small">
                      {tr(LINE_KINDS[l.kind] ?? l.kind)} · {fmtQty(l.quantity)} {l.unit} × {formatMoney(l.unit_price, j.currency)}
                      {l.posted_at && ` · ${tr("taken from the store")}`}
                    </div>
                  </div>
                  <strong style={{ whiteSpace: "nowrap" }}>{formatMoney(Number(l.quantity) * Number(l.unit_price), j.currency)}</strong>
                </div>
                {worker && open && !l.posted_at && (planner || l.created_by === user.id) && (
                  <form action={removeJobLine}>
                    <input type="hidden" name="job_id" value={j.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <button type="submit" className="btn btn-small">
                      {tr("Remove")}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {worker && open && (
          <details style={{ marginTop: 12 }}>
            <summary className="btn btn-small">{tr("+ Add material or work")}</summary>
            <form action={addJobLine} style={{ marginTop: 10 }}>
              <input type="hidden" name="job_id" value={j.id} />
              <div className="grid grid-2">
                <div className="field">
                  <label htmlFor="line-kind">{tr("Kind")}</label>
                  <select id="line-kind" name="kind" defaultValue="material">
                    {Object.entries(LINE_KINDS).map(([k, label]) => (
                      <option key={k} value={k}>
                        {tr(label)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="line-product">{tr("Item")}</label>
                  <select id="line-product" name="product_id" defaultValue="">
                    <option value="">{tr("— Not in the catalogue —")}</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.sku})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ gridColumn: "1 / -1" }}>
                  <label htmlFor="line-desc">{tr("Description")}</label>
                  <input id="line-desc" name="description" type="text" maxLength={300} placeholder={tr("Leave empty to use the item's name")} />
                </div>
                <div className="field">
                  <label htmlFor="line-qty">{tr("Quantity")}</label>
                  <input id="line-qty" name="quantity" type="text" inputMode="decimal" required />
                </div>
                <div className="field">
                  <label htmlFor="line-unit">{tr("Unit")}</label>
                  <input id="line-unit" name="unit" type="text" maxLength={20} placeholder={tr("e.g. m, pcs, hour")} />
                </div>
                <div className="field">
                  <label htmlFor="line-price">{tr("Price each")}</label>
                  <input id="line-price" name="unit_price" type="text" inputMode="decimal" placeholder={tr("Leave empty for the list price")} />
                </div>
              </div>
              <SubmitButton className="btn btn-small">{tr("Add")}</SubmitButton>
            </form>
          </details>
        )}
      </section>

      <section className="card" id="hours">
        <h2>
          {tr("Hours")} <span className="small muted">· {fmtQty(hoursTotal)} h</span>
        </h2>
        {hours.length === 0 ? (
          <p className="muted small">{tr("No hours recorded on this job yet.")}</p>
        ) : (
          <ul className="lines">
            {hours.map((h) => (
              <li key={h.id}>
                <div className="line-head">
                  <div>
                    <div className="desc">
                      {names.get(h.user_id) ?? tr("Team member")} · {formatDate(h.work_date)}
                    </div>
                    <div className="muted small">
                      {h.description}
                      {!h.billable && ` · ${tr("not billable")}`}
                      {h.invoice_id && ` · ${tr("invoiced")}`}
                    </div>
                  </div>
                  <strong>{fmtQty(h.hours)} h</strong>
                </div>
                {!h.invoice_id && (h.user_id === user.id || hasRole(roles, "management")) && (
                  <form action={removeJobHours}>
                    <input type="hidden" name="job_id" value={j.id} />
                    <input type="hidden" name="entry_id" value={h.id} />
                    <button type="submit" className="btn btn-small">
                      {tr("Remove")}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {worker && (open || j.status === "completed") && (
          <form action={addJobHours} style={{ marginTop: 12 }}>
            <input type="hidden" name="job_id" value={j.id} />
            <div className="grid grid-2">
              {hasRole(roles, "management") && people.length > 0 && (
                <div className="field">
                  <label htmlFor="h-user">{tr("Who")}</label>
                  <select id="h-user" name="user_id" defaultValue={user.id}>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="field">
                <label htmlFor="h-date">{tr("Day")}</label>
                <input id="h-date" name="work_date" type="date" defaultValue={todayTz()} />
              </div>
              <div className="field">
                <label htmlFor="h-hours">{tr("Hours")}</label>
                <input id="h-hours" name="hours" type="text" inputMode="decimal" required placeholder="2.5" />
              </div>
              <div className="field">
                <label htmlFor="h-billable">{tr("Billable")}</label>
                <select id="h-billable" name="billable" defaultValue="yes">
                  <option value="yes">{tr("Yes, charge the client")}</option>
                  <option value="no">{tr("No")}</option>
                </select>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="h-desc">{tr("What was done")}</label>
                <input id="h-desc" name="description" type="text" maxLength={500} />
              </div>
            </div>
            <SubmitButton className="btn btn-small">{tr("Record hours")}</SubmitButton>
          </form>
        )}
      </section>

      {(planner || canInvoiceService(roles)) && (
        <section className="card">
          <h2>{tr("To bill")}</h2>
          {j.price != null ? (
            <p className="small">{tr("Agreed price for the job.")}</p>
          ) : (
            <p className="small muted">{tr("Materials and work on the job plus billable hours not yet invoiced (at each person's rate).")}</p>
          )}
          <div className="sj-total">
            <span>{tr("Total before VAT")}</span>
            <span>{formatMoney(billValue, j.currency)}</span>
          </div>
          {j.status === "completed" && canInvoiceService(roles) && (
            <form action={invoiceJob} style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={j.id} />
              <SubmitButton className="btn btn-primary btn-block">{tr("Make invoice")}</SubmitButton>
            </form>
          )}
        </section>
      )}

      {j.status !== "scheduled" && (j.completed_at || j.signed_by_name || signatureUrl) && (
        <section className="card">
          <h2>{tr("Sign-off")}</h2>
          <p className="small">
            {j.completed_at && `${tr("Completed")} ${formatDateTime(j.completed_at)}`}
            {j.signed_by_name && ` · ${tr("accepted by")} ${j.signed_by_name}`}
          </p>
          {signatureUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={signatureUrl} alt={tr("Client's signature")} className="sj-sig-img" />
          )}
        </section>
      )}

      {worker && open && (
        <section className="card" id="finish">
          <h2>{tr("Finish and sign off")}</h2>
          <SignOff jobId={j.id} companyId={company.id} findings={j.findings ?? ""} />
        </section>
      )}

      {planner && open && (
        <details className="card" id="details">
          <summary>
            <strong>{tr("Change the job")}</strong>
          </summary>
          <form action={saveJob} style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={j.id} />
            <JobFields
              v={j}
              people={people}
              stores={stores.map((s) => ({ id: s.id, name: s.name }))}
              equipment={((eqData ?? []) as { id: string; name: string; serial_no: string | null }[]).map((e) => ({ id: e.id, name: `${e.name}${e.serial_no ? ` (${e.serial_no})` : ""}` }))}
              projects={((prjData ?? []) as { id: string; number: string; name: string }[]).map((p) => ({ id: p.id, name: `${p.number} · ${p.name}` }))}
              currencies={currencies}
            />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
          <form action={jobStatus} style={{ marginTop: 16 }}>
            <input type="hidden" name="id" value={j.id} />
            <input type="hidden" name="status" value="cancelled" />
            <div className="field">
              <label htmlFor="reason">{tr("Cancel the job")}</label>
              <input id="reason" name="reason" type="text" maxLength={300} required placeholder={tr("Why, e.g. client postponed")} />
            </div>
            <SubmitButton className="btn btn-small" pendingText="…">
              {tr("Cancel job")}
            </SubmitButton>
          </form>
        </details>
      )}
    </>
  );
}
