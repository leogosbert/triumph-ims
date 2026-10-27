import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { canSeeCompliance } from "@/lib/compliance/model";
import { changedRules, legalRules, RULE_GROUPS, TZ_LEGAL, type RuleDef } from "@/lib/compliance/rules";
import { resetRules, saveRules } from "../actions";
import { ComplianceTabs, Disclaimer } from "../parts";
import { hasRole } from "@/lib/roles";

export const metadata = { title: "Tax & legal rules" };

function shown(def: RuleDef, v: unknown): string {
  if (typeof v === "boolean") return v ? tr("Yes") : tr("No");
  if (def.unit === "TZS") return formatMoney(Number(v));
  if (typeof v === "string") return v || "—";
  return `${v}${def.unit === "%" ? "%" : def.unit ? ` ${tr(def.unit)}` : ""}`;
}

export default async function RulesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!canSeeCompliance(roles)) redirect("/");
  const { data, error } = await supabase.from("compliance_settings").select("legal_rules").eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Tax & legal rules" />;
  const rules = legalRules(data?.legal_rules);
  const changed = new Set(changedRules(rules));
  const edit = hasRole(roles, "management") || hasRole(roles, "finance");

  return (
    <>
      <h1>{tr("Tax & legal rules")}</h1>
      <ComplianceTabs current="/compliance/rules" />
      <p className="muted small">
        {tr(
          "The numbers the compliance screens use: VAT threshold, due days, penalties, record keeping and data protection. They start at the law as we understand it for mainland Tanzania. When a Finance Act changes one, change it here; the filing calendar follows the due days.",
        )}
      </p>
      <Notice {...notice} />
      {changed.size > 0 && (
        <p className="banner warn small">
          {changed.size} {tr("rules changed from the law as shipped. They are marked Changed below.")}
        </p>
      )}

      <form action={saveRules}>
        {RULE_GROUPS.map((g) => (
          <section key={g.key} className="card">
            <h2 style={{ marginBottom: 2 }}>{tr(g.title)}</h2>
            <p className="small muted" style={{ marginTop: 0 }}>
              {tr(g.law)}
            </p>
            <div className="grid grid-2">
              {g.rules.map((def) => {
                const v = rules[def.key];
                const base = TZ_LEGAL[def.key];
                const id = `rule_${def.key}`;
                return (
                  <div key={def.key} className="field">
                    {typeof base === "boolean" ? (
                      <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                        <input type="hidden" name={`${def.key}__shown`} value="1" />
                        <input type="checkbox" name={def.key} value="1" defaultChecked={Boolean(v)} disabled={!edit} style={{ marginTop: 4 }} />
                        <span>{tr(def.label)}</span>
                      </label>
                    ) : (
                      <>
                        <label htmlFor={id}>
                          {tr(def.label)}
                          {def.unit && <span className="hint"> · {tr(def.unit)}</span>}
                        </label>
                        <input
                          id={id}
                          name={def.key}
                          type={typeof base === "number" ? "number" : "text"}
                          min={def.min ?? 0}
                          max={def.max}
                          step={def.unit === "%" ? "0.01" : "1"}
                          maxLength={typeof base === "string" ? 200 : undefined}
                          defaultValue={String(v)}
                          disabled={!edit}
                        />
                      </>
                    )}
                    <span className="hint small">
                      {def.hint && `${tr(def.hint)} · `}
                      {changed.has(def.key) ? (
                        <>
                          <span className="badge tone-info">{tr("Changed")}</span> {tr("The law as shipped")}: {shown(def, base)}
                        </>
                      ) : (
                        tr("As the law")
                      )}
                      {def.verify && (
                        <>
                          {" · "}
                          <span className="badge tone-warn">{tr("Check details")}</span>
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {edit && (
          <div style={{ position: "sticky", bottom: 8, marginTop: 12 }}>
            <SubmitButton className="btn btn-primary btn-block">{tr("Save the rules")}</SubmitButton>
          </div>
        )}
      </form>
      {edit && changed.size > 0 && (
        <form action={resetRules} className="card" style={{ marginTop: 12 }}>
          <p className="small">{tr("Go back to the law as shipped for every rule. The usual TRA filings go back to their normal due days.")}</p>
          <SubmitButton className="btn btn-small">{tr("Reset to the law")}</SubmitButton>
        </form>
      )}
      {!edit && <p className="small muted">{tr("Management and finance can change these rules.")}</p>}
      <p className="small muted">
        {tr("Marked Check details: we are not certain of the figure or it changes often. Confirm it with TRA, the council or your accountant before you rely on it.")}
      </p>
      <Disclaimer compact />
    </>
  );
}
