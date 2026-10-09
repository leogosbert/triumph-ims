import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { LevelBadge } from "@/components/suggestions/SuggestionBadge";
import { LEVEL_LABEL, LEVELS } from "@/components/suggestions/meta";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { setCompanyCategory, setCompanyFeature, setCompanyLevel } from "../../actions";
import { groupByCategory, loadCategories } from "../../categories";
import { platformAdmin } from "../../guard";

export const metadata = { title: "Company" };

type PlatformCompany = {
  id: string;
  name: string;
  business_level: string;
  is_demo: boolean;
  created_at: string;
  members: number;
  last_activity: string | null;
  features_on: number;
  open_recommendations: number;
  onboarding_done: boolean;
};

type Feature = { key: string; name: string; module: string | null; default_level: string; status: string; active: boolean; sort: number };
type State = { key: string; enabled: boolean; source: string };

const SOURCE_LABEL: Record<string, string> = {
  manual: "set by the company",
  admin: "set by LeMo Tech",
  recommendation: "from a recommendation",
};

/** On / Off / Default for one feature; the current choice is shown pressed. */
function Switches({ current }: { current: "on" | "off" | "default" }) {
  return (
    <>
      {(["on", "off", "default"] as const).map((v) => (
        <SubmitButton
          key={v}
          className={`btn btn-small${current === v ? " adm-pressed" : ""}`}
          name="enabled"
          value={v}
          pendingText="…"
          disabled={current === v}
        >
          {tr(v === "on" ? "On" : v === "off" ? "Off" : "Default")}
        </SubmitButton>
      ))}
    </>
  );
}

/**
 * One company, as LeMo Tech sees it: only the platform summary, its level and which features it
 * has (app settings). Never the company's business data.
 */
export default async function AdminCompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase } = admin;

  const [{ data, error }, { data: fData }, categories, { data: sData, error: sError }] = await Promise.all([
    supabase.rpc("platform_companies"),
    supabase.from("features").select("key, name, module, default_level, status, active, sort").order("sort").order("name"),
    loadCategories(supabase),
    supabase.rpc("admin_company_features", { p_company: id }),
  ]);
  const c = ((data ?? []) as PlatformCompany[]).find((x) => x.id === id);
  const features = ((fData ?? []) as Feature[]).filter((f) => f.status === "live" && f.active);
  const groups = groupByCategory(categories.list, features);
  // Which features this company has. Before the feature categories SQL is run this is null and the
  // switches work as before, without showing the current state.
  const states = sError || !Array.isArray(sData) ? null : new Map((sData as State[]).map((x) => [x.key, x]));
  const rank = (l: string) => LEVELS.indexOf(l as never);

  if (!c) {
    return (
      <>
        <p className="small">
          <Link href="/admin/companies">{tr("← Companies")}</Link>
        </p>
        <p className={error ? "notice notice-error" : "card muted"}>
          {error ? tr("Could not load companies. Check that the Stage 11 database update has been run.") : tr("Company not found.")}
        </p>
      </>
    );
  }

  return (
    <>
      <p className="small">
        <Link href="/admin/companies">{tr("← Companies")}</Link>
      </p>
      <div className="page-head">
        <h2 className="adm-title">{c.name}</h2>
        <LevelBadge level={c.business_level} />
      </div>
      <Notice {...notice} />

      <section className="card">
        <dl className="kv">
          <dt>{tr("Registered")}</dt>
          <dd>{formatDate(c.created_at)}</dd>
          <dt>{tr("Members")}</dt>
          <dd>{c.members}</dd>
          <dt>{tr("Last activity")}</dt>
          <dd>{c.last_activity ? formatDateTime(c.last_activity) : tr("No activity yet")}</dd>
          <dt>{tr("Features on")}</dt>
          <dd>{c.features_on}</dd>
          <dt>{tr("Open recommendations")}</dt>
          <dd>{c.open_recommendations}</dd>
          <dt>{tr("Setup")}</dt>
          <dd>{c.onboarding_done ? tr("Finished") : tr("Not finished")}</dd>
          {c.is_demo && (
            <>
              <dt>{tr("Type")}</dt>
              <dd>{tr("Demo company")}</dd>
            </>
          )}
        </dl>
        <p className="hint" style={{ marginBottom: 0 }}>
          {tr("For privacy, the admin platform never shows a company's customers, products, prices or documents.")}
        </p>
      </section>

      <section className="card">
        <h2>{tr("Business level")}</h2>
        <p className="muted small">
          {tr("The level sets the default set of features. Changing it never deletes data, and features switched on or off individually keep their setting.")}
        </p>
        <form action={setCompanyLevel} className="adm-inline-form">
          <input type="hidden" name="company_id" value={c.id} />
          <select name="level" defaultValue={c.business_level} aria-label={tr("Business level")}>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {tr(LEVEL_LABEL[l])}
              </option>
            ))}
          </select>
          <SubmitButton className="btn btn-primary" pendingText={tr("Saving…")}>
            {tr("Change level")}
          </SubmitButton>
        </form>
      </section>

      <section className="card" id="features">
        <h2>{tr("Features for this company")}</h2>
        <p className="muted small">
          {states
            ? tr("Add or remove features for this company only, one by one or a whole category at once. On and Off override the level default; Default gives the company what its level includes again. These are app settings, never the company's business data.")
            : tr("Turn a live feature on or off for this company only. This overrides the level default. Run the feature categories database update to see which features the company has now and to switch whole categories.")}
        </p>
        {states && (
          <p className="feat-summary">
            {tr("{on} of {live} available features are switched on.")
              .replace("{on}", String(features.filter((f) => states.get(f.key)?.enabled).length))
              .replace("{live}", String(features.length))}
          </p>
        )}
        {features.length === 0 ? (
          <p className="muted small">{tr("No live features found.")}</p>
        ) : (
          groups.map(({ category, items }) => {
            const onCount = states ? items.filter((f) => states.get(f.key)?.enabled).length : null;
            return (
              <div key={category.name} className="adm-module">
                <div className="adm-cat-head">
                  <h3>
                    {tr(category.name)}
                    {onCount !== null && (
                      <span className="adm-cat-count">
                        {onCount}/{items.length} {tr("on")}
                      </span>
                    )}
                  </h3>
                  {states && (
                    <form action={setCompanyCategory} className="adm-onoff" aria-label={`${tr("Whole category")}: ${tr(category.name)}`}>
                      <input type="hidden" name="company_id" value={c.id} />
                      <input type="hidden" name="category" value={category.name} />
                      <SubmitButton className="btn btn-small" name="enabled" value="on" pendingText="…">
                        {tr("All on")}
                      </SubmitButton>
                      <SubmitButton className="btn btn-small" name="enabled" value="off" pendingText="…">
                        {tr("All off")}
                      </SubmitButton>
                      <SubmitButton className="btn btn-small" name="enabled" value="default" pendingText="…">
                        {tr("Default")}
                      </SubmitButton>
                    </form>
                  )}
                </div>
                <ul className="list">
                  {items.map((f) => {
                    const st = states?.get(f.key);
                    return (
                      <li key={f.key}>
                        <div className="row adm-feature-row">
                          <span>
                            {st && (
                              <>
                                <span className={`badge ${st.enabled ? "tone-ok" : "tone-off"}`}>{st.enabled ? tr("On") : tr("Off")}</span>{" "}
                              </>
                            )}
                            {f.name}{" "}
                            <span className="small muted">
                              {st && st.source !== "level"
                                ? `· ${tr(SOURCE_LABEL[st.source] ?? st.source)}`
                                : rank(c.business_level) >= rank(f.default_level)
                                  ? tr("· included in this level")
                                  : `· ${tr("from")} ${tr(LEVEL_LABEL[f.default_level] ?? f.default_level)}`}
                            </span>
                          </span>
                          <form action={setCompanyFeature} className="adm-onoff">
                            <input type="hidden" name="company_id" value={c.id} />
                            <input type="hidden" name="key" value={f.key} />
                            {st ? (
                              <Switches current={st.source === "level" ? "default" : st.enabled ? "on" : "off"} />
                            ) : (
                              <>
                                <SubmitButton className="btn btn-small" name="enabled" value="on" pendingText="…">
                                  {tr("On")}
                                </SubmitButton>
                                <SubmitButton className="btn btn-small" name="enabled" value="off" pendingText="…">
                                  {tr("Off")}
                                </SubmitButton>
                              </>
                            )}
                          </form>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })
        )}
      </section>
    </>
  );
}
