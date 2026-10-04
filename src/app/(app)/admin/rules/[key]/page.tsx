import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { LEVEL_LABEL, LEVELS } from "@/components/suggestions/meta";
import { readNotice, type SearchParams } from "@/lib/messages";
import { deleteRule, saveRule } from "../../actions";
import { platformAdmin } from "../../guard";
import { METRICS, OP_LABEL, OPS } from "../meta";
import { RuleSentence, type Rule } from "../RuleSentence";

export const metadata = { title: "Growth rule" };

type Feature = { key: string; name: string; default_level: string; status: string };

export default async function AdminRulePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const notice = await readNotice(searchParams);
  const isNew = key === "new";

  const [{ data: rData }, { data: fData }] = await Promise.all([
    isNew ? Promise.resolve({ data: null }) : admin.supabase.from("recommendation_rules").select("*").eq("key", key).maybeSingle(),
    admin.supabase.from("features").select("key, name, default_level, status").order("sort").order("name"),
  ]);
  const r = (rData as Rule | null) ?? null;
  const features = (fData ?? []) as Feature[];
  if (!isNew && !r) {
    return (
      <>
        <p className="small">
          <Link href="/admin/rules">{tr("← Growth rules")}</Link>
        </p>
        <p className="card muted">{tr("Rule not found.")}</p>
      </>
    );
  }
  const targetType = r?.target_level ? "level" : "feature";
  const applies = new Set(r?.applies_to ?? ["small"]);
  const featureName = features.find((f) => f.key === r?.feature_key)?.name ?? r?.feature_key ?? "—";

  return (
    <>
      <p className="small">
        <Link href="/admin/rules">{tr("← Growth rules")}</Link>
      </p>
      <h2 className="adm-title">{isNew ? tr("New growth rule") : r!.title}</h2>
      <Notice {...notice} />
      {r && (
        <p className="card adm-explain small">
          <RuleSentence r={r} featureName={featureName} />
        </p>
      )}

      <form action={saveRule}>
        <input type="hidden" name="is_new" value={isNew ? "1" : "0"} />
        <section className="card">
          <h2>{tr("Rule")}</h2>
          <div className="field">
            <label htmlFor="r-key">{tr("Key")}</label>
            {isNew ? (
              <input id="r-key" name="key" required pattern="[a-z][a-z0-9_]{1,49}" placeholder="many_products" />
            ) : (
              <>
                <input id="r-key" value={r!.key} disabled />
                <input type="hidden" name="key" value={r!.key} />
              </>
            )}
          </div>
          <div className="field">
            <label htmlFor="r-title">{tr("Title")}</label>
            <input id="r-title" name="title" required maxLength={120} defaultValue={r?.title ?? ""} placeholder={tr("e.g. Growing catalogue")} />
          </div>
        </section>

        <section className="card">
          <h2>{tr("When")}</h2>
          <div className="field">
            <label htmlFor="r-metric">{tr("What to measure")}</label>
            <select id="r-metric" name="metric" required defaultValue={r?.metric ?? ""}>
              <option value="" disabled>
                {tr("Choose a number")}
              </option>
              {METRICS.map((m) => (
                <option key={m.key} value={m.key}>
                  {tr(m.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="adm-grid2">
            <div className="field">
              <label htmlFor="r-op">{tr("Comparison")}</label>
              <select id="r-op" name="op" defaultValue={r?.op ?? ">="}>
                {OPS.map((o) => (
                  <option key={o} value={o}>
                    {tr(OP_LABEL[o])} ({o})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="r-th">{tr("Threshold")}</label>
              <input id="r-th" name="threshold" type="number" min={0} step="any" required defaultValue={r?.threshold ?? ""} />
            </div>
          </div>
          <fieldset className="plain field">
            <legend className="sg-label">{tr("For companies at these levels")}</legend>
            <div className="adm-checks">
              {LEVELS.map((l) => (
                <label key={l} className="check">
                  <input type="checkbox" name="applies_to" value={l} defaultChecked={applies.has(l)} /> {tr(LEVEL_LABEL[l])}
                </label>
              ))}
            </div>
          </fieldset>
        </section>

        <section className="card">
          <h2>{tr("Recommend")}</h2>
          <fieldset className="plain field">
            <label className="check adm-radio">
              <input type="radio" name="target_type" value="feature" defaultChecked={targetType === "feature"} /> {tr("Switch on a feature")}
            </label>
            <select name="feature_key" defaultValue={r?.feature_key ?? ""} aria-label={tr("Feature")}>
              <option value="">{tr("Choose a feature")}</option>
              {features.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name} ({tr(LEVEL_LABEL[f.default_level] ?? f.default_level)}
                  {f.status === "planned" ? `, ${tr("planned")}` : ""})
                </option>
              ))}
            </select>
          </fieldset>
          <fieldset className="plain field">
            <label className="check adm-radio">
              <input type="radio" name="target_type" value="level" defaultChecked={targetType === "level"} /> {tr("Move up to a business level")}
            </label>
            <select name="target_level" defaultValue={r?.target_level ?? "medium"} aria-label={tr("Level")}>
              {LEVELS.filter((l) => l !== "small").map((l) => (
                <option key={l} value={l}>
                  {tr(LEVEL_LABEL[l])}
                </option>
              ))}
            </select>
          </fieldset>
          <div className="field">
            <label htmlFor="r-msg">{tr("Message to the owner")}</label>
            <textarea id="r-msg" name="message" rows={3} maxLength={500} defaultValue={r?.message ?? ""} />
            <p className="hint">
              {tr("Explain the reason in simple words. {value} is replaced by the company's number and {threshold} by the rule's threshold, e.g. “Your catalogue has grown to {value} products.”")}
            </p>
          </div>
          <div className="adm-grid2">
            <div className="field">
              <label htmlFor="r-sort">{tr("Sort order")}</label>
              <input id="r-sort" name="sort" type="number" min={0} step={1} defaultValue={r?.sort ?? 100} />
            </div>
            <div className="field adm-center">
              <label className="check">
                <input type="checkbox" name="active" defaultChecked={r ? r.active : true} /> {tr("Active")}
              </label>
            </div>
          </div>
        </section>

        <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Saving…")}>
          {isNew ? tr("Add rule") : tr("Save rule")}
        </SubmitButton>
      </form>

      {!isNew && (
        <section className="card adm-danger" id="delete">
          <h2>{tr("Delete this rule")}</h2>
          <p className="muted small">{tr("Recommendations this rule already made are removed too. To pause a rule instead, untick Active.")}</p>
          <form action={deleteRule}>
            <input type="hidden" name="key" value={r!.key} />
            <label className="check">
              <input type="checkbox" name="confirm" /> {tr("Yes, delete it")}
            </label>
            <div style={{ marginTop: 10 }}>
              <SubmitButton className="btn btn-danger" pendingText={tr("Deleting…")}>
                {tr("Delete rule")}
              </SubmitButton>
            </div>
          </form>
        </section>
      )}
    </>
  );
}
