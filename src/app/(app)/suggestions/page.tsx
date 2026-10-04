import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import "./suggestions.css";
import { Notice } from "@/components/Notice";
import { SuggestionBadge } from "@/components/suggestions/SuggestionBadge";
import { categoryLabel, isMissingSql } from "@/components/suggestions/meta";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";

export const metadata = { title: "Suggestion Box" };

type Tab = { key: string; label: string; managersOnly?: boolean };

const TABS: Tab[] = [
  { key: "review", label: "To review", managersOnly: true },
  { key: "mine", label: "My suggestions" },
  { key: "assigned", label: "Assigned to me" },
  { key: "implemented", label: "Implemented" },
  { key: "all", label: "All", managersOnly: true },
];

const EMPTY: Record<string, string> = {
  review: "Nothing waiting for review. New suggestions from the team will appear here.",
  mine: "You have not sent any suggestions yet. Every good idea counts — tap “+ New suggestion”.",
  assigned: "Nothing is assigned to you right now.",
  implemented: "No implemented suggestions yet. They will be celebrated here.",
  all: "No suggestions yet. Encourage your team to share their ideas.",
};

type Row = {
  id: string;
  number: string | null;
  title: string;
  category: string;
  status: string;
  created_by: string | null;
  assigned_to: string | null;
  is_internal: boolean;
  about_app: boolean;
  created_at: string;
};

export default async function SuggestionsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, user, isManager } = await getAppContext();

  const tabs = TABS.filter((t) => isManager || !t.managersOnly);
  const tab = tabs.find((t) => t.key === sp.tab) ?? tabs[0];

  let q = supabase
    .from("suggestions")
    .select("id, number, title, category, status, created_by, assigned_to, is_internal, about_app, created_at")
    .eq("company_id", company.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (tab.key === "mine") q = q.eq("created_by", user.id);
  else if (tab.key === "review") q = q.in("status", ["submitted", "under_review", "needs_clarification"]);
  else if (tab.key === "assigned") q = q.eq("assigned_to", user.id).neq("status", "archived");
  else if (tab.key === "implemented") q = q.eq("status", "implemented");
  const { data, error } = await q;
  const missing = isMissingSql(error);
  const rows = (data ?? []) as Row[];
  const names = isManager ? await namesFor(supabase, rows.map((r) => r.created_by)) : new Map<string, string>();

  return (
    <>
      <div className="page-head">
        <h1>{tr("Suggestion Box")}</h1>
        {!missing && (
          <Link href="/suggestions/new" className="btn btn-primary btn-small">
            {tr("+ New suggestion")}
          </Link>
        )}
      </div>
      <p className="muted small sg-lead">
        {tr("Ideas that make us better: lower costs, happier customers, smarter stock and purchasing, safer work.")}
      </p>
      <Notice {...notice} />

      {missing ? (
        <div className="banner warn">
          <p style={{ margin: 0 }}>
            {isManager
              ? tr("The Suggestion Box needs the Stage 11 database update. Run it in Supabase, then refresh this page.")
              : tr("The Suggestion Box is not ready yet. Please ask your manager.")}
          </p>
        </div>
      ) : (
        <>
          <nav className="tabs-row" aria-label={tr("Filter")}>
            {tabs.map((t) => (
              <Link key={t.key} href={`/suggestions?tab=${t.key}`} aria-current={t.key === tab.key ? "page" : undefined}>
                {tr(t.label)}
              </Link>
            ))}
          </nav>
          {error && <p className="notice notice-error">{tr("Could not load suggestions. Please try again.")}</p>}
          {!error && rows.length === 0 ? (
            <div className="card sg-empty">
              <div className="sg-empty-icon" aria-hidden>
                💡
              </div>
              <p>{tr(EMPTY[tab.key] ?? EMPTY.all)}</p>
              {(tab.key === "mine" || tab.key === "all") && (
                <Link href="/suggestions/new" className="btn btn-primary">
                  {tr("Share an idea")}
                </Link>
              )}
            </div>
          ) : (
            <ul className="rec-list sg-list">
              {rows.map((r) => (
                <li key={r.id}>
                  <Link href={`/suggestions/${r.id}`}>
                    <div className="main">
                      <div className="title">{r.title}</div>
                      <div className="sub">
                        <span className="sg-num">{r.number ?? "—"}</span>
                        {" · "}
                        {tr(categoryLabel(r.category))}
                        {r.is_internal && (
                          <>
                            {" · "}
                            {tr("Internal improvement")}
                          </>
                        )}
                        {r.about_app && (
                          <>
                            {" · "}
                            {tr("About the app")}
                          </>
                        )}
                        {isManager && r.created_by && (
                          <>
                            {" · "}
                            {r.created_by === user.id ? tr("You") : (names.get(r.created_by) ?? tr("Team member"))}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="side">
                      <SuggestionBadge status={r.status} />
                      <div className="small muted">{formatDate(r.created_at)}</div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </>
  );
}
