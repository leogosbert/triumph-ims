import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { ACTIVITY_GUIDES, COMPLIANCE_CATALOGUE, COMPLIANCE_CATEGORIES } from "@/lib/compliance/catalogue";
import { adoptRequirements } from "../../actions";
import { Disclaimer } from "../../parts";

export const metadata = { title: "Add requirements" };

export default async function AdoptPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) redirect("/compliance/checklist");
  const { data, error } = await supabase.from("compliance_items").select("code").eq("company_id", company.id).not("code", "is", null).limit(1000);
  if (isMissingTable(error)) return <NotReady title="Add requirements" />;
  const have = new Set(((data ?? []) as { code: string }[]).map((r) => r.code));
  const first = have.size === 0;
  const guide = ACTIVITY_GUIDES.find((g) => g.key === sp.activity);
  const preset = new Set(guide ? guide.codes : first ? COMPLIANCE_CATALOGUE.filter((r) => r.starter).map((r) => r.code) : []);

  return (
    <>
      <p className="small">
        <Link href="/compliance/checklist">{tr("← Checklist")}</Link>
      </p>
      <h1>{first ? tr("Set up my checklist") : tr("Add requirements")}</h1>
      <p className="muted small">
        {guide
          ? `${tr("For")}: ${tr(guide.title)}. ${tr("The requirements for this activity are ticked.")}`
          : first
            ? tr("The usual requirements for a newly registered general supply company are ticked. Untick what does not apply; you can add sector licences later.")
            : tr("Tick what you want to add. Requirements already on your checklist are shown greyed.")}
      </p>
      <Notice {...notice} />
      <form action={adoptRequirements}>
        {!have.has("BRELA_INCORPORATION") && (
          <label className="card" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input type="checkbox" name="registered" value="1" defaultChecked style={{ marginTop: 4 }} />
            <span>
              <strong>{tr("We are already registered with BRELA")}</strong>
              <br />
              <span className="small muted">{tr("The certificate of incorporation and MEMART are marked done; upload the copies afterwards.")}</span>
            </span>
          </label>
        )}
        {COMPLIANCE_CATEGORIES.map((c, idx) => {
          const reqs = COMPLIANCE_CATALOGUE.filter((r) => r.category === c.key);
          const ticked = reqs.filter((r) => preset.has(r.code) && !have.has(r.code)).length;
          return (
            <details key={c.key} className="card" open={idx < 2 || ticked > 0}>
              <summary>
                <strong>{tr(c.label)}</strong>{" "}
                <span className="small muted">
                  · {reqs.length} {tr("items")}
                  {ticked > 0 && ` · ${ticked} ${tr("ticked")}`}
                </span>
              </summary>
              <p className="small muted" style={{ margin: "6px 0" }}>
                {tr(c.blurb)}
              </p>
              <ul className="lines">
                {reqs.map((r) => {
                  const on = have.has(r.code);
                  return (
                    <li key={r.code}>
                      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", opacity: on ? 0.55 : 1 }}>
                        <input type="checkbox" name="code" value={r.code} defaultChecked={!on && preset.has(r.code)} disabled={on} style={{ marginTop: 4 }} />
                        <span>
                          <span className="desc">{tr(r.name)}</span>
                          {on && <span className="badge tone-ok" style={{ marginLeft: 6 }}>{tr("On your checklist")}</span>}
                          {r.verify && (
                            <span className="badge tone-warn" style={{ marginLeft: 6 }} title={tr(r.verifyNote ?? "")}>
                              {tr("Check details")}
                            </span>
                          )}
                          <br />
                          <span className="small muted">
                            {tr(r.authority)} · {r.appliesTo === "always" ? tr("Every company") : tr(r.condition ?? "")}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </details>
          );
        })}
        <div style={{ position: "sticky", bottom: 8, marginTop: 12 }}>
          <SubmitButton className="btn btn-primary btn-block">{tr("Add to my checklist")}</SubmitButton>
        </div>
      </form>
      <Disclaimer />
    </>
  );
}
