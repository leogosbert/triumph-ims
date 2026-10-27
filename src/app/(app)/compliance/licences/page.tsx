import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, noAccess } from "@/lib/context";
import { daysUntil, isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { canSeeCompliance, LICENCE_FIELDS, LICENCE_STATUS, type Licence } from "@/lib/compliance/model";
import { StatusBadge } from "@/lib/sales";
import { addUsualLicences } from "../actions";
import { ComplianceTabs, Disclaimer } from "../parts";

export const metadata = { title: "Licences" };

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const FILTERS = [
  ["all", "All"],
  ["active", "Active"],
  ["pending", "To apply for or applied"],
  ["expiring", "Expiring in 90 days"],
  ["expired", "Expired or suspended"],
] as const;

export default async function LicencesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, isManager } = await getAppContext();
  if (!canSeeCompliance(roles)) noAccess();
  const status = pick(sp.status) ?? "all";
  const q = (pick(sp.q) ?? "").trim().toLowerCase();
  const authority = pick(sp.authority) ?? "";

  const [{ data, error }, links] = await Promise.all([
    supabase.from("licences").select(LICENCE_FIELDS).eq("company_id", company.id).order("expires_on", { ascending: true, nullsFirst: false }).order("name").limit(1000),
    supabase.from("compliance_documents").select("licence_id").eq("company_id", company.id).not("licence_id", "is", null).limit(5000),
  ]);
  if (isMissingTable(error)) return <NotReady title="Licences" />;
  if (error) throw new Error(error.message);
  const all = (data ?? []) as Licence[];
  const docs = new Map<string, number>();
  for (const l of (links.data ?? []) as { licence_id: string }[]) docs.set(l.licence_id, (docs.get(l.licence_id) ?? 0) + 1);

  const expiringSoon = (l: Licence) => l.status === "active" && l.expires_on !== null && (daysUntil(l.expires_on) ?? 999) <= 90;
  const match: Record<string, (l: Licence) => boolean> = {
    all: () => true,
    active: (l) => l.status === "active",
    pending: (l) => l.status === "planned" || l.status === "applied",
    expiring: expiringSoon,
    expired: (l) => l.status === "expired" || l.status === "suspended",
  };
  const counts = Object.fromEntries(FILTERS.map(([k]) => [k, all.filter(match[k]).length])) as Record<string, number>;
  const authorities = [...new Set(all.map((l) => l.authority).filter((a): a is string => !!a))].sort();
  const shown = all
    .filter(match[status] ?? match.all)
    .filter((l) => !authority || l.authority === authority)
    .filter((l) => !q || `${l.name} ${l.authority ?? ""} ${l.licence_no ?? ""} ${l.product_scope ?? ""} ${l.category ?? ""}`.toLowerCase().includes(q));

  return (
    <>
      <div className="page-head">
        <h1>{tr("Licences")}</h1>
        {isManager && (
          <Link href="/compliance/licences/new" className="btn btn-primary btn-small">
            {tr("+ Licence")}
          </Link>
        )}
      </div>
      <ComplianceTabs current="/compliance/licences" />
      <p className="muted small">
        {tr("Every licence, permit and certificate the company holds or plans to get, as many as you need: number, dates, what it covers and the copy. You are reminded before each one expires.")}
      </p>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={`/compliance/licences?status=${k}`} aria-current={status === k ? "page" : undefined}>
            {tr(label)} ({counts[k]})
          </Link>
        ))}
      </nav>
      {all.length > 0 && (
        <form method="get" className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          <input type="hidden" name="status" value={status} />
          <div className="field" style={{ flex: "1 1 180px", margin: 0 }}>
            <label htmlFor="q">{tr("Search")}</label>
            <input id="q" name="q" type="search" defaultValue={q} placeholder={tr("Name, number or products covered")} />
          </div>
          {authorities.length > 1 && (
            <div className="field" style={{ flex: "1 1 140px", margin: 0 }}>
              <label htmlFor="authority">{tr("Authority")}</label>
              <select id="authority" name="authority" defaultValue={authority}>
                <option value="">{tr("All")}</option>
                {authorities.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
          )}
          <button type="submit" className="btn btn-small">
            {tr("Show")}
          </button>
        </form>
      )}

      {all.length === 0 ? (
        <section className="card">
          <p>{tr("No licences recorded yet. A newly registered general supply company usually starts with the business licence and adds sector licences (GCLA for chemicals, EWURA for petroleum products, mine vendor registrations) as the work comes.")}</p>
          {isManager && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <form action={addUsualLicences}>
                <input type="hidden" name="back" value="/compliance/licences" />
                <SubmitButton className="btn btn-primary btn-small">{tr("Add the licences on my checklist")}</SubmitButton>
              </form>
              <Link href="/compliance/licences/new" className="btn btn-small">
                {tr("+ Licence")}
              </Link>
            </div>
          )}
        </section>
      ) : shown.length === 0 ? (
        <p className="card muted">{tr("Nothing here.")}</p>
      ) : (
        <ul className="rec-list">
          {shown.map((l) => {
            const left = l.expires_on ? daysUntil(l.expires_on) : null;
            return (
              <li key={l.id}>
                <Link href={`/compliance/licences/${l.id}`}>
                  <div className="main">
                    <div className="title">
                      {(docs.get(l.id) ?? 0) > 0 ? "📎 " : ""}
                      {l.name}
                    </div>
                    <div className="sub">
                      {[l.authority, l.licence_no, l.product_scope].filter(Boolean).join(" · ")}
                      {l.expires_on && ` · ${tr("expires")} ${formatDate(l.expires_on)}`}
                    </div>
                  </div>
                  <div className="side" style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                    <StatusBadge map={LICENCE_STATUS} status={l.status} />
                    {l.status === "active" && left !== null && left <= 90 && (
                      <span className={`badge tone-${left < 0 ? "bad" : left <= 30 ? "warn" : "info"}`}>
                        {left < 0 ? tr("Past expiry") : `${left} ${tr("days left")}`}
                      </span>
                    )}
                    {l.status === "active" && !(docs.get(l.id) ?? 0) && <span className="badge tone-warn">{tr("Upload the copy")}</span>}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {isManager && all.length > 0 && (
        <form action={addUsualLicences} style={{ marginTop: 12 }}>
          <input type="hidden" name="back" value="/compliance/licences" />
          <SubmitButton className="btn btn-small">{tr("Add the licences on my checklist")}</SubmitButton>
          <p className="hint small">{tr("Each licence on your checklist that is not in the register yet gets a line here, to fill in.")}</p>
        </form>
      )}
      <Disclaimer compact />
    </>
  );
}
