import { primeLang, tr } from "@/lib/tr";
import { RemoveFromPhone } from "@/components/RemoveFromPhone";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { CountUp } from "./CountUp";
import { LevelBadge } from "@/components/suggestions/SuggestionBadge";
import { LEVEL_LABEL, LEVELS } from "@/components/suggestions/meta";
import { platformAdmin } from "./guard";
import { productInsights, type Adoption, type FeedbackStat } from "./insights";

export const metadata = { title: "Admin overview" };

type Overview = {
  companies_total?: number;
  by_level?: Record<string, number>;
  demo_companies?: number;
  users_total?: number;
  active_companies_30d?: number;
  suggestions_30d?: number;
  open_recommendations?: number;
};

const fmt = (v: unknown) => (Number(v) || 0).toLocaleString("en-GB");

export default async function AdminOverviewPage() {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const { supabase } = admin;

  const [ov, ad, fb] = await Promise.all([
    supabase.rpc("platform_overview"),
    supabase.rpc("platform_feature_adoption"),
    supabase.rpc("platform_feedback_stats"),
  ]);
  const o = (ov.data ?? {}) as Overview;
  const adoption = ((ad.data ?? []) as Adoption[]).slice();
  const stats = (fb.data ?? []) as FeedbackStat[];
  const byLevel = o.by_level ?? {};
  const levelMax = Math.max(1, ...LEVELS.map((l) => Number(byLevel[l]) || 0));
  const insights = productInsights(stats, adoption, ov.error ? null : byLevel);
  const failed = ov.error || ad.error || fb.error;

  adoption.sort((a, b) => {
    if (a.status !== b.status) return a.status === "live" ? -1 : 1;
    return LEVELS.indexOf(a.default_level as never) - LEVELS.indexOf(b.default_level as never) || a.name.localeCompare(b.name);
  });

  return (
    <>
      {failed && <p className="notice notice-error">{tr("Some numbers could not be loaded. Check that the Stage 11 database update has been run.")}</p>}

      {!ov.error && (
        <>
          <div className="stat-grid adm-stats">
            {(
              [
                ["building", "Companies", o.companies_total, "blue"],
                ["team", "Users", o.users_total, "teal"],
                ["activity", "Active companies (30 days)", o.active_companies_30d, "green"],
                ["inbox", "Suggestions (30 days)", o.suggestions_30d, "amber"],
                ["check", "Open growth recommendations", o.open_recommendations, "purple"],
                ["help", "Demo companies", o.demo_companies, "gray"],
              ] as const
            ).map(([icon, label, v, tone]) => (
              <div key={label} className={`stat adm-stat adm-tone-${tone}`}>
                <span className="adm-stat-icon" aria-hidden>
                  <Icon name={icon} size={20} />
                </span>
                <div className="n">
                  <CountUp value={Number(v) || 0} />
                </div>
                <div className="l">{tr(label)}</div>
              </div>
            ))}
          </div>

          <section className="card">
            <h2>{tr("Companies by level")}</h2>
            <ul className="adm-bars">
              {LEVELS.map((l) => {
                const v = Number(byLevel[l]) || 0;
                return (
                  <li key={l}>
                    <span className="adm-bar-label">{tr(LEVEL_LABEL[l])}</span>
                    <span className="adm-bar-track">
                      <span className={`adm-bar-fill adm-fill-${l}`} style={{ width: `${(v / levelMax) * 100}%` }} />
                    </span>
                    <span className="adm-bar-n">{fmt(v)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        </>
      )}

      <section className="card adm-insights">
        <h2>{tr("Product insights")}</h2>
        <p className="muted small">{tr("Plain recommendations from anonymous suggestions and feature use across all real companies.")}</p>
        <ul>
          {insights.map((i, k) => (
            <li key={k} className={`adm-insight adm-insight-${i.tone}`}>
              {i.text}
            </li>
          ))}
        </ul>
        <p className="small" style={{ marginBottom: 0 }}>
          <Link href="/admin/feedback">{tr("See all feedback →")}</Link>
        </p>
      </section>

      <section className="card">
        <h2>{tr("Feature adoption")}</h2>
        {ad.error ? (
          <p className="muted small">{tr("Could not load feature adoption.")}</p>
        ) : adoption.length === 0 ? (
          <p className="muted small">{tr("No features yet.")}</p>
        ) : (
          <div className="scroll-x">
            <table className="adm-table">
              <thead>
                <tr>
                  <th>{tr("Feature")}</th>
                  <th>{tr("Level")}</th>
                  <th className="adm-wide">{tr("Companies using it")}</th>
                </tr>
              </thead>
              <tbody>
                {adoption.map((a) => {
                  const total = Number(a.total_companies) || 0;
                  const on = Number(a.enabled_companies) || 0;
                  const pct = total ? Math.round((on / total) * 100) : 0;
                  return (
                    <tr key={a.key} className={a.status === "planned" ? "adm-planned" : undefined}>
                      <td>
                        {a.name}
                        {a.status === "planned" && <span className="badge tone-off adm-mini">{tr("Planned")}</span>}
                      </td>
                      <td>
                        <LevelBadge level={a.default_level} />
                      </td>
                      <td>
                        <span className="adm-pct">
                          <span className="adm-bar-track">
                            <span className="adm-bar-fill" style={{ width: `${pct}%` }} />
                          </span>
                          <span className="adm-bar-n">
                            {pct}% <span className="muted">({on}/{total})</span>
                          </span>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <details className="card adm-remove">
        <summary>
          <strong>{tr("Remove LeMoSp ADMIN from this phone")}</strong>
        </summary>
        <RemoveFromPhone admin />
      </details>
    </>
  );
}
