import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, noAccess } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { AUDIT_PACKS } from "@/lib/compliance/audits";
import { ACTIVITY_GUIDES, categoryLabel, requirement, type Requirement } from "@/lib/compliance/catalogue";
import { canSeeCompliance, searchCompliance, STANDING_LABEL, standingOf, type ComplianceItem, type Standing } from "@/lib/compliance/model";
import { adoptPack } from "../actions";
import { ComplianceTabs, Disclaimer, RequirementFacts } from "../parts";

export const metadata = { title: "What do I need?" };

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function GuidePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, isManager } = await getAppContext();
  if (!canSeeCompliance(roles)) noAccess();
  const q = (pick(sp.q) ?? "").trim().slice(0, 200);
  const guide = ACTIVITY_GUIDES.find((g) => g.key === pick(sp.activity));
  const one = requirement(pick(sp.code));

  const [itemsRes, linksRes, licRes] = await Promise.all([
    supabase.from("compliance_items").select("id, code, status").eq("company_id", company.id).not("code", "is", null).limit(1000),
    supabase.from("compliance_documents").select("item_id").eq("company_id", company.id).not("item_id", "is", null).limit(5000),
    supabase.from("licences").select("catalogue_code").eq("company_id", company.id).eq("status", "active").not("catalogue_code", "is", null).limit(1000),
  ]);
  if (isMissingTable(itemsRes.error)) return <NotReady title="What do I need?" />;
  const items = new Map<string, Pick<ComplianceItem, "id" | "status">>();
  for (const i of (itemsRes.data ?? []) as { id: string; code: string; status: ComplianceItem["status"] }[]) items.set(i.code, i);
  const docs = new Map<string, number>();
  for (const l of (linksRes.data ?? []) as { item_id: string }[]) docs.set(l.item_id, (docs.get(l.item_id) ?? 0) + 1);
  const active = new Set(((licRes.data ?? []) as { catalogue_code: string }[]).map((l) => l.catalogue_code));
  const standing = (code: string): Standing => standingOf(code, items, docs, active);

  const found = q ? searchCompliance(q) : null;
  const packs = q ? AUDIT_PACKS.filter((p) => q.toLowerCase().split(/\s+/).some((w) => w.length > 2 && `${p.title} ${p.words}`.toLowerCase().includes(w))).slice(0, 3) : [];

  const ReqRow = ({ r, back }: { r: Requirement; back: string }) => {
    const s = standing(r.code);
    const item = items.get(r.code);
    return (
      <li id={r.code}>
        <details>
          <summary className="line-head" style={{ alignItems: "flex-start" }}>
            <span>
              <span className="desc">{tr(r.name)}</span>
              <br />
              <span className="small muted">
                {tr(r.authority)} · {tr(categoryLabel(r.category))}
              </span>
            </span>
            <span className={`badge tone-${STANDING_LABEL[s].tone}`}>{tr(STANDING_LABEL[s].label)}</span>
          </summary>
          <div style={{ padding: "6px 0 10px" }}>
            <RequirementFacts r={r} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
              {item ? (
                <Link href={`/compliance/checklist/${item.id}`} className="btn btn-small">
                  {tr("Open on the checklist")}
                </Link>
              ) : (
                isManager && (
                  <form action={adoptPack}>
                    <input type="hidden" name="back" value={back} />
                    <input type="hidden" name="code" value={r.code} />
                    <SubmitButton className="btn btn-small btn-primary">{tr("Add to my checklist")}</SubmitButton>
                  </form>
                )
              )}
              {r.kind === "licence" && isManager && !active.has(r.code) && (
                <Link href={`/compliance/licences/new?code=${r.code}${item ? `&item=${item.id}` : ""}`} className="btn btn-small">
                  {tr("+ Add to the licence register")}
                </Link>
              )}
            </div>
          </div>
        </details>
      </li>
    );
  };

  const back = `/compliance/guide${one ? `?code=${one.code}` : guide ? `?activity=${guide.key}` : q ? `?q=${encodeURIComponent(q)}` : ""}`;

  return (
    <>
      <h1>{tr("What do I need?")}</h1>
      <ComplianceTabs current="/compliance/guide" />
      <p className="muted small">
        {tr("Ask in your own words or pick what you are about to do. Each answer shows what is needed, who issues it, the usual documents, and whether you already have it.")}
      </p>
      <Notice {...notice} />
      <form method="get" className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="search" name="q" defaultValue={q} placeholder={tr("e.g. supplying lubricants to a mine")} aria-label={tr("Question")} style={{ flex: "1 1 200px", minWidth: 0 }} />
        <button type="submit" className="btn">
          {tr("Show")}
        </button>
      </form>

      {one && (
        <section className="card">
          <h2>{tr(one.name)}</h2>
          <ul className="lines">
            <ReqRow r={one} back={back} />
          </ul>
        </section>
      )}

      {found && (
        <section className="card">
          <h2>
            {tr("Answers for")} “{q}”
          </h2>
          {found.guides.map((g) => (
            <p key={g.key} className="small">
              <Link href={`/compliance/guide?activity=${g.key}`}>
                <strong>{tr(g.title)}</strong>
              </Link>{" "}
              — {tr(g.summary)}
            </p>
          ))}
          {packs.map((p) => (
            <p key={p.key} className="small">
              <Link href={`/compliance/audits/${p.key}`}>
                <strong>{tr(p.title)}</strong>
              </Link>{" "}
              — {tr("the papers they usually ask for, checked against yours")}
            </p>
          ))}
          {found.requirements.length > 0 ? (
            <ul className="lines">
              {found.requirements.map((r) => (
                <ReqRow key={r.code} r={r} back={back} />
              ))}
            </ul>
          ) : (
            found.guides.length === 0 &&
            packs.length === 0 && <p className="small muted">{tr("Nothing found. Try other words (for example: chemicals, tender, staff, VAT, mine) or pick an activity below.")}</p>
          )}
        </section>
      )}

      {guide && (
        <section className="card">
          <h2>{tr(guide.title)}</h2>
          <p className="small">{tr(guide.summary)}</p>
          {(() => {
            const have = guide.codes.filter((c) => standing(c) === "have" || standing(c) === "not_applicable").length;
            return (
              <p className="small muted">
                {have}/{guide.codes.length} {tr("in place")}
              </p>
            );
          })()}
          <ul className="lines">
            {guide.codes.map((c) => {
              const r = requirement(c);
              return r ? <ReqRow key={c} r={r} back={back} /> : null;
            })}
          </ul>
          {guide.tips.length > 0 && (
            <>
              <h3>{tr("Good to know")}</h3>
              <ul className="small" style={{ paddingLeft: 18 }}>
                {guide.tips.map((t) => (
                  <li key={t}>{tr(t)}</li>
                ))}
              </ul>
            </>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {isManager && (
              <Link href={`/compliance/checklist/adopt?activity=${guide.key}`} className="btn btn-primary btn-small">
                {tr("Add these to my checklist")}
              </Link>
            )}
            {guide.links.map((l) => (
              <Link key={l.href} href={l.href} className="btn btn-small">
                {tr(l.label)}
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="card">
        <h2>{tr("Pick what you are about to do")}</h2>
        <ul className="rec-list">
          {ACTIVITY_GUIDES.map((g) => (
            <li key={g.key}>
              <Link href={`/compliance/guide?activity=${g.key}`} aria-current={guide?.key === g.key ? "page" : undefined}>
                <div className="main">
                  <div className="title">{tr(g.question)}</div>
                  <div className="sub">{tr(g.summary)}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
        <p className="small" style={{ marginTop: 8 }}>
          <Link href="/compliance/audits">{tr("An inspection or audit is coming? Open the inspection packs →")}</Link>
        </p>
      </section>
      <Disclaimer />
    </>
  );
}
