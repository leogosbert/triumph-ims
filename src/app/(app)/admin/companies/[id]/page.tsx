import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { LevelBadge } from "@/components/suggestions/SuggestionBadge";
import { LEVEL_LABEL, LEVELS } from "@/components/suggestions/meta";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { setCompanyFeature, setCompanyLevel } from "../../actions";
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

/**
 * One company, as LeMo Tech sees it: only the platform summary, its level and feature switches.
 * Never the company's business data.
 */
export default async function AdminCompanyPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase } = admin;

  const [{ data, error }, { data: fData }] = await Promise.all([
    supabase.rpc("platform_companies"),
    supabase.from("features").select("key, name, module, default_level, status, active, sort").order("sort").order("name"),
  ]);
  const c = ((data ?? []) as PlatformCompany[]).find((x) => x.id === id);
  const features = ((fData ?? []) as Feature[]).filter((f) => f.status === "live" && f.active);
  const modules = [...new Set(features.map((f) => f.module ?? "Other"))];
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
        <h2>{tr("Feature switches")}</h2>
        <p className="muted small">
          {tr("Turn a live feature on or off for this company only. This overrides the level default. To protect privacy, the company's current switches are not shown here, only how many features are on.")}
        </p>
        {features.length === 0 ? (
          <p className="muted small">{tr("No live features found.")}</p>
        ) : (
          modules.map((m) => (
            <div key={m} className="adm-module">
              <h3>{tr(m)}</h3>
              <ul className="list">
                {features
                  .filter((f) => (f.module ?? "Other") === m)
                  .map((f) => (
                    <li key={f.key}>
                      <div className="row adm-feature-row">
                        <span>
                          {f.name}{" "}
                          <span className="small muted">
                            {rank(c.business_level) >= rank(f.default_level)
                              ? tr("· included in this level")
                              : `· ${tr("from")} ${tr(LEVEL_LABEL[f.default_level] ?? f.default_level)}`}
                          </span>
                        </span>
                        <form action={setCompanyFeature} className="adm-onoff">
                          <input type="hidden" name="company_id" value={c.id} />
                          <input type="hidden" name="key" value={f.key} />
                          <SubmitButton className="btn btn-small" name="enabled" value="on" pendingText="…">
                            {tr("On")}
                          </SubmitButton>
                          <SubmitButton className="btn btn-small" name="enabled" value="off" pendingText="…">
                            {tr("Off")}
                          </SubmitButton>
                        </form>
                      </div>
                    </li>
                  ))}
              </ul>
            </div>
          ))
        )}
      </section>
    </>
  );
}
