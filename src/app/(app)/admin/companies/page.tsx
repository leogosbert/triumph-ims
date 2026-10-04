import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { LevelBadge } from "@/components/suggestions/SuggestionBadge";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { platformAdmin } from "../guard";

export const metadata = { title: "Companies" };

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

export default async function AdminCompaniesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const q = (typeof sp.q === "string" ? sp.q : "").trim().slice(0, 80);
  const showDemo = sp.demo === "1";
  const level = typeof sp.level === "string" ? sp.level : "";

  const { data, error } = await admin.supabase.rpc("platform_companies");
  const all = (data ?? []) as PlatformCompany[];
  const demoCount = all.filter((c) => c.is_demo).length;
  const rows = all
    .filter((c) => showDemo || !c.is_demo)
    .filter((c) => !level || c.business_level === level)
    .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (b.last_activity ?? b.created_at).localeCompare(a.last_activity ?? a.created_at));

  const link = (over: Record<string, string>) => {
    const p = new URLSearchParams();
    const merged = { q, level, demo: showDemo ? "1" : "", ...over };
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v);
    const s = p.toString();
    return `/admin/companies${s ? `?${s}` : ""}`;
  };

  return (
    <>
      <Notice {...notice} />
      <form className="card toolbar" method="get" role="search">
        <div className="toolbar-row">
          <input type="search" name="q" defaultValue={q} placeholder={tr("Company name")} aria-label={tr("Search")} />
          {level && <input type="hidden" name="level" value={level} />}
          {showDemo && <input type="hidden" name="demo" value="1" />}
          <button className="btn" type="submit">
            {tr("Search")}
          </button>
        </div>
      </form>
      <nav className="tabs-row" aria-label={tr("Filter")}>
        <Link href={link({ level: "" })} aria-current={!level ? "page" : undefined}>
          {tr("All levels")}
        </Link>
        <Link href={link({ level: "small" })} aria-current={level === "small" ? "page" : undefined}>
          {tr("Small")}
        </Link>
        <Link href={link({ level: "medium" })} aria-current={level === "medium" ? "page" : undefined}>
          {tr("Medium")}
        </Link>
        <Link href={link({ level: "enterprise" })} aria-current={level === "enterprise" ? "page" : undefined}>
          {tr("Enterprise")}
        </Link>
      </nav>
      <p className="small muted adm-row-between">
        <span>
          {rows.length} {tr("companies")}
        </span>
        <Link href={link({ demo: showDemo ? "" : "1" })}>
          {showDemo ? tr("Hide demo companies") : `${tr("Show demo companies")} (${demoCount})`}
        </Link>
      </p>

      {error ? (
        <p className="notice notice-error">{tr("Could not load companies. Check that the Stage 11 database update has been run.")}</p>
      ) : rows.length === 0 ? (
        <p className="card muted">{tr("No companies match.")}</p>
      ) : (
        <ul className="rec-list">
          {rows.map((c) => (
            <li key={c.id}>
              <Link href={`/admin/companies/${c.id}`}>
                <div className="main">
                  <div className="title">
                    {c.name}
                    {c.is_demo && <span className="badge tone-off adm-mini">{tr("Demo")}</span>}
                  </div>
                  <div className="sub">
                    {c.members} {tr("members")} · {c.features_on} {tr("features on")}
                    {c.open_recommendations > 0 && (
                      <>
                        {" · "}
                        <span className="text-warn">
                          {c.open_recommendations} {tr("open recommendations")}
                        </span>
                      </>
                    )}
                    {!c.onboarding_done && (
                      <>
                        {" · "}
                        {tr("Setup not finished")}
                      </>
                    )}
                  </div>
                </div>
                <div className="side adm-side">
                  <LevelBadge level={c.business_level} />
                  <div className="small muted">
                    {c.last_activity ? `${tr("Active")} ${formatDate(c.last_activity)}` : tr("No activity yet")}
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
