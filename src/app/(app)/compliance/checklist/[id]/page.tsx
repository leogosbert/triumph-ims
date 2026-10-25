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
import { companyPeople, namesFor } from "@/lib/people";
import { categoryLabel, requirement } from "@/lib/compliance/catalogue";
import {
  canSeeCompliance,
  canWriteItem,
  DEADLINE_FIELDS,
  DEADLINE_STATUS,
  dueRuleText,
  FREQUENCIES,
  ITEM_FIELDS,
  ITEM_STATUS,
  LICENCE_STATUS,
  periodLabel,
  type ComplianceItem,
  type Deadline,
} from "@/lib/compliance/model";
import { StatusBadge } from "@/lib/sales";
import { deleteItem, saveItem, setItemStatus } from "../../actions";
import { ItemFields } from "../../ItemFields";
import { LinkedFiles } from "../../LinkedFiles";
import { Disclaimer, RequirementFacts } from "../../parts";

export const metadata = { title: "Compliance item" };

const DOC_KIND: Record<string, string> = { company: "company", tax: "tax", social_security: "certificate", insurance: "insurance" };

export default async function ItemPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, isManager } = await getAppContext();
  if (!canSeeCompliance(role)) redirect("/");
  const { data, error } = await supabase.from("compliance_items").select(ITEM_FIELDS).eq("id", id).eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Compliance item" />;
  if (!data) notFound();
  const item = data as ComplianceItem;
  const req = requirement(item.code);
  const write = canWriteItem(role, item.finance_ok);
  const back = `/compliance/checklist/${item.id}`;

  const [deadlinesRes, licenceRes, licencesRes, people, names] = await Promise.all([
    supabase
      .from("compliance_deadlines")
      .select(DEADLINE_FIELDS)
      .eq("item_id", item.id)
      .order("due_on", { ascending: false })
      .limit(8),
    item.licence_id
      ? supabase.from("licences").select("id, name, status, expires_on").eq("id", item.licence_id).maybeSingle()
      : Promise.resolve({ data: null }),
    write ? supabase.from("licences").select("id, name").eq("company_id", company.id).order("name").limit(500) : Promise.resolve({ data: [] }),
    write ? companyPeople(supabase, company.id) : Promise.resolve([]),
    namesFor(supabase, [item.owner_id, item.done_by]),
  ]);
  const deadlines = (deadlinesRes.data ?? []) as Deadline[];
  const licence = licenceRes.data as { id: string; name: string; status: string; expires_on: string | null } | null;
  const rule = dueRuleText(item);
  const statusButtons: [string, string][] = [
    ["in_progress", "In progress"],
    ["done", "Done"],
    ["not_started", "Not started"],
    ["not_applicable", "Does not apply"],
  ];

  return (
    <>
      <p className="small">
        <Link href="/compliance/checklist">{tr("← Checklist")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{tr(item.name)}</h1>
        <StatusBadge map={ITEM_STATUS} status={item.status} />
      </div>
      <p className="muted small">
        {tr(categoryLabel(item.category))}
        {item.authority && ` · ${tr(item.authority)}`}
        {item.owner_id && ` · ${tr("responsible")}: ${names.get(item.owner_id) ?? "—"}`}
        {item.due_on && ` · ${tr("due")} ${formatDate(item.due_on)}`}
      </p>
      <Notice {...notice} />
      {item.status_note && <p className="small">{item.status_note}</p>}
      {item.done_on && (
        <p className="small muted">
          {tr("Done")} {formatDate(item.done_on)}
          {item.done_by && ` · ${names.get(item.done_by) ?? ""}`}
        </p>
      )}

      {write && (
        <form action={setItemStatus} className="card">
          <input type="hidden" name="id" value={item.id} />
          <input type="hidden" name="back" value={back} />
          <div className="field">
            <label htmlFor="note">{tr("Note (optional)")}</label>
            <input id="note" name="note" type="text" maxLength={500} placeholder={tr("e.g. Applied on 3 Nov, receipt no. 1234")} />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {statusButtons
              .filter(([s]) => s !== item.status)
              .map(([s, label]) => (
                <SubmitButton key={s} name="status" value={s} className={`btn btn-small${s === "done" ? " btn-primary" : ""}`}>
                  {tr(label)}
                </SubmitButton>
              ))}
          </div>
        </form>
      )}

      {req && (
        <section className="card">
          <h2>{tr("What it is")}</h2>
          <RequirementFacts r={req} open />
        </section>
      )}
      {!req && item.notes && (
        <section className="card">
          <p className="small" style={{ whiteSpace: "pre-wrap" }}>
            {item.notes}
          </p>
        </section>
      )}

      {(item.frequency !== "none" || deadlines.length > 0) && (
        <section className="card">
          <div className="page-head" style={{ marginBottom: 6 }}>
            <h2 style={{ margin: 0 }}>{tr("Filings")}</h2>
            <Link href="/compliance/calendar" className="small">
              {tr("Calendar →")}
            </Link>
          </div>
          <p className="small muted">
            {tr(FREQUENCIES[item.frequency])}
            {rule ? ` · ${tr("due")} ${tr(rule)}` : ` · ${tr("set the due date above each time")}`}
          </p>
          {deadlines.length > 0 && (
            <ul className="lines">
              {deadlines.map((d) => (
                <li key={d.id} className="line-head">
                  <span>
                    {periodLabel(d.period_start, d.period_end)} <span className="small muted">· {tr("due")} {formatDate(d.due_on)}</span>
                    {d.reference && <span className="small muted"> · {d.reference}</span>}
                  </span>
                  <StatusBadge map={DEADLINE_STATUS} status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {(licence || req?.kind === "licence") && (
        <section className="card">
          <h2>{tr("Licence register")}</h2>
          {licence ? (
            <p>
              <Link href={`/compliance/licences/${licence.id}`}>{licence.name}</Link> <StatusBadge map={LICENCE_STATUS} status={licence.status} />
              {licence.expires_on && <span className="small muted"> · {tr("expires")} {formatDate(licence.expires_on)}</span>}
            </p>
          ) : (
            <p className="small muted">{tr("Keep the number, dates and expiry in the licences register to be reminded before it runs out.")}</p>
          )}
          {isManager && !licence && (
            <Link href={`/compliance/licences/new?code=${encodeURIComponent(item.code ?? "")}&item=${item.id}`} className="btn btn-small">
              {tr("+ Add to the licence register")}
            </Link>
          )}
        </section>
      )}

      <LinkedFiles
        supabase={supabase}
        companyId={company.id}
        itemId={item.id}
        canEdit={write}
        back={back}
        defaultTitle={item.name}
        defaultKind={req?.kind === "licence" ? "licence" : (DOC_KIND[item.category] ?? "other")}
      />

      {write && (
        <details className="card">
          <summary>{tr("Edit details")}</summary>
          <form action={saveItem} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={item.id} />
            <ItemFields
              v={item}
              people={people}
              licences={(licencesRes.data ?? []) as { id: string; name: string }[]}
              categories={isManager ? undefined : ["tax", "social_security"]}
              fromCatalogue={!!item.code}
            />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
      {isManager && (
        <form action={deleteItem} style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={item.id} />
          <SubmitButton className="btn btn-small" pendingText="…">
            {tr("Remove from the checklist")}
          </SubmitButton>
          <p className="hint small">{tr("Its filings go too; linked documents stay in the library. If it simply does not apply, use Does not apply instead.")}</p>
        </form>
      )}
      <Disclaimer compact />
    </>
  );
}
