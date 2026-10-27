import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { AUDIT_PACKS, checkPack } from "@/lib/compliance/audits";
import { canSeeCompliance } from "@/lib/compliance/model";
import { todayTz } from "@/lib/services";
import { ComplianceTabs, Disclaimer } from "../parts";
import { loadPackData } from "./data";

export const metadata = { title: "Inspections & audits" };

const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function AuditsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!canSeeCompliance(roles)) redirect("/");
  const d = await loadPackData(supabase, company.id, todayTz(), roles);
  if ("missing" in d) {
    if (isMissingTable(d.error as { code?: string; message?: string })) return <NotReady title="Inspections & audits" />;
    throw new Error(String((d.error as { message?: string })?.message ?? "error"));
  }
  const q = (pick(sp.q) ?? "").trim().toLowerCase();
  const packs = AUDIT_PACKS.filter((p) => !q || `${p.title} ${p.who} ${p.words}`.toLowerCase().includes(q)).map((p) => ({ p, c: checkPack(p, d) }));

  return (
    <>
      <h1>{tr("Inspections & audits")}</h1>
      <ComplianceTabs current="/compliance/audits" />
      <p className="muted small">
        {tr("When TRA, a labour officer, OSHA, GCLA, the council or a mine's vendor team comes, these are the papers they usually ask for. Each pack checks itself against your checklist, licences and documents, so you know what to fix before the visit and can print the file.")}
      </p>
      <Notice {...notice} />
      <form method="get" className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input type="search" name="q" defaultValue={q} placeholder={tr("Who is coming? e.g. TRA, OSHA, mine")} aria-label={tr("Search")} style={{ flex: "1 1 200px", minWidth: 0 }} />
        <button type="submit" className="btn btn-small">
          {tr("Show")}
        </button>
      </form>
      <ul className="rec-list">
        {packs.map(({ p, c }) => {
          const missing = c.lines.filter((l) => l.state === "missing").length;
          const due = c.lines.filter((l) => l.state === "due").length;
          return (
            <li key={p.key}>
              <Link href={`/compliance/audits/${p.key}`}>
                <div className="main">
                  <div className="title">{tr(p.title)}</div>
                  <div className="sub">
                    {tr(p.who)} · {c.ready}/{c.counted} {tr("ready")}
                    {missing > 0 && ` · ${missing} ${tr("missing")}`}
                    {due > 0 && ` · ${due} ${tr("need attention")}`}
                  </div>
                  <div className="progress-mini-track" style={{ maxWidth: "none", marginTop: 6 }} aria-hidden="true">
                    <span style={{ width: `${c.pct}%`, background: c.pct >= 80 ? "var(--ok, var(--brand))" : "var(--brand)" }} />
                  </div>
                </div>
                <div className="side">
                  <span className={`badge tone-${c.pct >= 80 ? "ok" : c.pct >= 50 ? "warn" : "bad"}`}>{c.pct}%</span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
      {packs.length === 0 && <p className="card muted">{tr("Nothing here.")}</p>}
      <Disclaimer compact />
    </>
  );
}
