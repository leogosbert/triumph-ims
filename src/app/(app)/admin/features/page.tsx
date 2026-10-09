import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { LevelBadge } from "@/components/suggestions/SuggestionBadge";
import { LEVELS } from "@/components/suggestions/meta";
import { readNotice, type SearchParams } from "@/lib/messages";
import { platformAdmin } from "../guard";
import { categoryHref, groupByCategory, loadCategories } from "../categories";

export const metadata = { title: "Features" };

type Feature = {
  key: string;
  name: string;
  module: string | null;
  default_level: string;
  status: string;
  active: boolean;
  route: string | null;
  sort: number;
  tutorial: unknown;
};

export default async function AdminFeaturesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const level = typeof sp.level === "string" && (LEVELS as readonly string[]).includes(sp.level) ? sp.level : "";

  let q = admin.supabase
    .from("features")
    .select("key, name, module, default_level, status, active, route, sort, tutorial")
    .order("sort")
    .order("name");
  if (level) q = q.eq("default_level", level);
  const [{ data, error }, categories] = await Promise.all([q, loadCategories(admin.supabase)]);
  const rows = (data ?? []) as Feature[];
  const groups = groupByCategory(categories.list, rows);

  return (
    <>
      <div className="page-head">
        <h2 className="adm-title">{tr("Feature catalogue")}</h2>
        <span className="adm-head-actions">
          <Link href="/admin/features/categories" className="btn btn-small">
            {tr("Categories")}
          </Link>
          <Link href="/admin/features/new" className="btn btn-primary btn-small">
            {tr("+ New feature")}
          </Link>
        </span>
      </div>
      <p className="muted small">
        {tr("Every feature the app can provide, grouped by category. Each feature has a default level: companies at that level or higher get it automatically, and you can switch it on or off for a single company on its page. Planned features are shown as “coming soon”.")}
      </p>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Filter")}>
        <Link href="/admin/features" aria-current={!level ? "page" : undefined}>
          {tr("All levels")}
        </Link>
        {LEVELS.map((l) => (
          <Link key={l} href={`/admin/features?level=${l}`} aria-current={level === l ? "page" : undefined}>
            {tr(l === "small" ? "Small" : l === "medium" ? "Medium" : "Enterprise")}
          </Link>
        ))}
      </nav>
      {error ? (
        <p className="notice notice-error">{tr("Could not load features. Check that the Stage 11 database update has been run.")}</p>
      ) : rows.length === 0 ? (
        <p className="card muted">{tr("No features yet.")}</p>
      ) : (
        groups.map(({ category, items }) => (
          <section key={category.name} className="adm-cat">
            <div className="adm-cat-head">
              <h3>
                {tr(category.name)} <span className="adm-cat-count">{items.length}</span>
              </h3>
              {categories.ready && (
                <Link href={categoryHref(category.name)} className="small">
                  {tr("Manage")}
                </Link>
              )}
            </div>
            {category.description && <p className="muted small adm-cat-desc">{tr(category.description)}</p>}
            <ul className="rec-list">
              {items.map((f) => {
                const steps = Array.isArray(f.tutorial) ? f.tutorial.length : 0;
                return (
                  <li key={f.key} className={!f.active ? "adm-inactive" : undefined}>
                    <Link href={`/admin/features/${encodeURIComponent(f.key)}`}>
                      <div className="main">
                        <div className="title">{f.name}</div>
                        <div className="sub">
                          <span className="sg-num">{f.key}</span>
                          {f.route ? ` · ${f.route}` : ""} · {steps} {tr("tutorial steps")}
                        </div>
                      </div>
                      <div className="side adm-side">
                        <LevelBadge level={f.default_level} />
                        <span className={`badge ${f.status === "live" ? "tone-ok" : "tone-off"}`}>
                          {f.status === "live" ? tr("Live") : tr("Planned")}
                        </span>
                        {!f.active && <span className="badge tone-bad">{tr("Hidden")}</span>}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </>
  );
}
