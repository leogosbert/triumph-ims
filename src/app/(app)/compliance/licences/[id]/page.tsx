import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { daysUntil, isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { requirement } from "@/lib/compliance/catalogue";
import { canSeeCompliance, LICENCE_FIELDS, LICENCE_STATUS, type Licence } from "@/lib/compliance/model";
import { StatusBadge } from "@/lib/sales";
import { deleteLicence, saveLicence, setLicenceStatus } from "../../actions";
import { LicenceFields } from "../../LicenceFields";
import { LinkedFiles } from "../../LinkedFiles";
import { Disclaimer, RequirementFacts } from "../../parts";

export const metadata = { title: "Licence" };

export default async function LicencePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, isManager } = await getAppContext();
  if (!canSeeCompliance(role)) redirect("/");
  const { data, error } = await supabase.from("licences").select(LICENCE_FIELDS).eq("id", id).eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Licence" />;
  if (!data) notFound();
  const l = data as Licence;
  const req = requirement(l.catalogue_code);
  const back = `/compliance/licences/${l.id}`;
  const { data: itemRows } = await supabase.from("compliance_items").select("id, name, status").eq("company_id", company.id).eq("licence_id", l.id).limit(20);
  const items = (itemRows ?? []) as { id: string; name: string; status: string }[];
  const left = l.expires_on ? daysUntil(l.expires_on) : null;

  const moves: [string, string, boolean][] = [
    ["applied", "Mark applied", l.status === "planned"],
    ["active", "Mark active (received)", l.status === "planned" || l.status === "applied" || l.status === "expired" || l.status === "suspended"],
    ["expired", "Mark expired", l.status === "active"],
    ["suspended", "Mark suspended", l.status === "active"],
    ["planned", "Back to To apply for", l.status === "applied" || l.status === "expired" || l.status === "suspended"],
  ];

  return (
    <>
      <p className="small">
        <Link href="/compliance/licences">{tr("← Licences")}</Link>
      </p>
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{l.name}</h1>
        <StatusBadge map={LICENCE_STATUS} status={l.status} />
      </div>
      <p className="muted small">
        {[l.authority, l.licence_no && `${tr("No.")} ${l.licence_no}`, l.category].filter(Boolean).join(" · ")}
      </p>
      <Notice {...notice} />

      <section className="card">
        <ul className="lines">
          {l.product_scope && (
            <li className="line-head">
              <span className="muted">{tr("Covers")}</span>
              <span>{l.product_scope}</span>
            </li>
          )}
          {l.applied_on && (
            <li className="line-head">
              <span className="muted">{tr("Applied on")}</span>
              <span>{formatDate(l.applied_on)}</span>
            </li>
          )}
          {l.issued_on && (
            <li className="line-head">
              <span className="muted">{tr("Issued on")}</span>
              <span>{formatDate(l.issued_on)}</span>
            </li>
          )}
          <li className="line-head">
            <span className="muted">{tr("Expires on")}</span>
            <span>
              {l.expires_on ? formatDate(l.expires_on) : tr("No expiry recorded")}
              {left !== null && l.status === "active" && (
                <span className={`badge tone-${left < 0 ? "bad" : left <= l.remind_days ? "warn" : "ok"}`} style={{ marginLeft: 6 }}>
                  {left < 0 ? tr("Past expiry") : `${left} ${tr("days left")}`}
                </span>
              )}
            </span>
          </li>
          <li className="line-head">
            <span className="muted">{tr("Reminder")}</span>
            <span>
              {l.remind_days} {tr("days before")}
            </span>
          </li>
          {l.cost !== null && (
            <li className="line-head">
              <span className="muted">{tr("Cost")}</span>
              <span>{formatMoney(l.cost, l.currency)}</span>
            </li>
          )}
        </ul>
        {l.conditions && (
          <p className="small" style={{ whiteSpace: "pre-wrap" }}>
            <strong>{tr("Conditions")}:</strong> {l.conditions}
          </p>
        )}
        {l.notes && (
          <p className="small muted" style={{ whiteSpace: "pre-wrap" }}>
            {l.notes}
          </p>
        )}
        {items.length > 0 && (
          <p className="small">
            {tr("On the checklist")}:{" "}
            {items.map((i, n) => (
              <span key={i.id}>
                {n > 0 && ", "}
                <Link href={`/compliance/checklist/${i.id}`}>{tr(i.name)}</Link>
              </span>
            ))}
          </p>
        )}
      </section>

      {isManager && (
        <form action={setLicenceStatus} className="card">
          <input type="hidden" name="id" value={l.id} />
          <div className="field">
            <label htmlFor="on">
              {tr("On")} <span className="hint">· {tr("empty = today; used as the applied or issued date")}</span>
            </label>
            <input id="on" name="on" type="date" />
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {moves
              .filter(([, , ok]) => ok)
              .map(([s, label]) => (
                <SubmitButton key={s} name="status" value={s} className={`btn btn-small${s === "active" ? " btn-primary" : ""}`}>
                  {tr(label)}
                </SubmitButton>
              ))}
          </div>
          {l.status === "expired" && <p className="hint small">{tr("Renewed? Enter the new expiry date under Edit details first, then mark it active.")}</p>}
        </form>
      )}

      <LinkedFiles
        supabase={supabase}
        companyId={company.id}
        licenceId={l.id}
        canEdit={isManager}
        back={back}
        defaultTitle={l.name}
        defaultKind="licence"
        defaultExpiry={l.expires_on}
        defaultReference={l.licence_no}
      />

      {req && (
        <details className="card">
          <summary>{tr("What the catalogue says")}</summary>
          <RequirementFacts r={req} />
        </details>
      )}

      {isManager && (
        <details className="card">
          <summary>{tr("Edit details")}</summary>
          <form action={saveLicence} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={l.id} />
            {/* ScanDocument goes here: it fills the named inputs below (name, authority, licence_no, issued_on, expires_on, product_scope, notes) */}
        <LicenceFields v={l} />
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        </details>
      )}
      {isManager && (
        <form action={deleteLicence} style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={l.id} />
          <SubmitButton className="btn btn-small" pendingText="…">
            {tr("Remove from the register")}
          </SubmitButton>
          <p className="hint small">{tr("Linked documents stay in the library. If it lapsed, mark it expired instead so the history is kept.")}</p>
        </form>
      )}
      <Disclaimer compact />
    </>
  );
}
