import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { readNotice, type SearchParams } from "@/lib/messages";
import { platformAdmin } from "../guard";
import { RuleSentence, type Rule } from "./RuleSentence";

export const metadata = { title: "Growth rules" };

export default async function AdminRulesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const notice = await readNotice(searchParams);

  const [{ data, error }, { data: fData }] = await Promise.all([
    admin.supabase.from("recommendation_rules").select("*").order("sort").order("key"),
    admin.supabase.from("features").select("key, name"),
  ]);
  const rules = (data ?? []) as Rule[];
  const fname = new Map(((fData ?? []) as { key: string; name: string }[]).map((f) => [f.key, f.name]));

  return (
    <>
      <div className="page-head">
        <h2 className="adm-title">{tr("Growth rules")}</h2>
        <Link href="/admin/rules/new" className="btn btn-primary btn-small">
          {tr("+ New rule")}
        </Link>
      </div>
      <Notice {...notice} />
      <div className="card adm-explain">
        <p style={{ marginTop: 0 }}>
          <strong>{tr("How rules work")}</strong>
        </p>
        <p className="small" style={{ marginBottom: 0 }}>
          {tr("Every day the app measures each company (team size, products, stores, sales and more). When a measured number passes a rule's threshold, and the company is at one of the rule's levels, the owner gets a recommendation with the message below — either to switch on a feature or to move up a level. Owners can accept, postpone or dismiss it. Features already on, and levels already reached, are skipped.")}
        </p>
      </div>
      {error ? (
        <p className="notice notice-error">{tr("Could not load rules. Check that the Stage 11 database update has been run.")}</p>
      ) : rules.length === 0 ? (
        <p className="card muted">{tr("No rules yet.")}</p>
      ) : (
        <ul className="rec-list">
          {rules.map((r) => (
            <li key={r.key} className={!r.active ? "adm-inactive" : undefined}>
              <Link href={`/admin/rules/${encodeURIComponent(r.key)}`}>
                <div className="main">
                  <div className="title">{r.title}</div>
                  <div className="sub adm-sentence">
                    <RuleSentence r={r} featureName={fname.get(r.feature_key ?? "") ?? r.feature_key ?? "—"} />
                  </div>
                </div>
                <div className="side adm-side">
                  <span className={`badge ${r.target_level ? "tone-info" : "tone-ok"}`}>{r.target_level ? tr("Level") : tr("Feature")}</span>
                  {!r.active && <span className="badge tone-off">{tr("Off")}</span>}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
