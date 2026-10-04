import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { LevelBadge, SuggestionBadge } from "@/components/suggestions/SuggestionBadge";
import { categoryLabel, LEVEL_LABEL, LEVELS, SUGGESTION_CATEGORIES, SUGGESTION_STATUS } from "@/components/suggestions/meta";
import { formatDate } from "@/lib/format";
import { type SearchParams } from "@/lib/messages";
import { platformAdmin } from "../guard";

export const metadata = { title: "Feedback" };

type Stat = { category: string; business_level: string; status: string; n: number | string };
/** Anonymous by design: no company, no author. */
type AppFeedback = { id: string; category: string; business_level: string | null; title: string; body: string | null; status: string; created_at: string };

export default async function AdminFeedbackPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const sp = (await searchParams) ?? {};
  const cat = typeof sp.cat === "string" ? sp.cat : "";

  const [st, fb] = await Promise.all([admin.supabase.rpc("platform_feedback_stats"), admin.supabase.rpc("platform_app_feedback", { p_limit: 100 })]);
  const stats = (st.data ?? []) as Stat[];
  const feedback = ((fb.data ?? []) as AppFeedback[]).filter((f) => !cat || f.category === cat);

  // Category × level counts.
  const cell = new Map<string, number>();
  const byStatus = new Map<string, number>();
  for (const r of stats) {
    const n = Number(r.n) || 0;
    cell.set(`${r.category}|${r.business_level}`, (cell.get(`${r.category}|${r.business_level}`) ?? 0) + n);
    byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + n);
  }
  const get = (c: string, l: string) => cell.get(`${c}|${l}`) ?? 0;
  const rowTotal = (c: string) => LEVELS.reduce((s, l) => s + get(c, l), 0);
  const colTotal = (l: string) => SUGGESTION_CATEGORIES.reduce((s, c) => s + get(c.key, l), 0);
  const grand = LEVELS.reduce((s, l) => s + colTotal(l), 0);
  const max = Math.max(1, ...SUGGESTION_CATEGORIES.flatMap((c) => LEVELS.map((l) => get(c.key, l))));
  const cats = SUGGESTION_CATEGORIES.slice().sort((a, b) => rowTotal(b.key) - rowTotal(a.key));
  const heat = (v: number) => (v === 0 ? undefined : { background: `rgba(20, 184, 166, ${(0.12 + 0.6 * (v / max)).toFixed(2)})` });

  return (
    <>
      <section className="card">
        <h2>{tr("Suggestions by topic and level")}</h2>
        <p className="muted small">
          {tr("All suggestions from real companies, counted without names. Darker cells are the topics people raise most.")}
        </p>
        {st.error ? (
          <p className="notice notice-error">{tr("Could not load feedback. Check that the Stage 11 database update has been run.")}</p>
        ) : grand === 0 ? (
          <p className="muted small">{tr("No suggestions yet.")}</p>
        ) : (
          <div className="scroll-x">
            <table className="adm-table adm-heat">
              <thead>
                <tr>
                  <th>{tr("Topic")}</th>
                  {LEVELS.map((l) => (
                    <th key={l}>{tr(LEVEL_LABEL[l])}</th>
                  ))}
                  <th>{tr("Total")}</th>
                </tr>
              </thead>
              <tbody>
                {cats.map((c) => (
                  <tr key={c.key}>
                    <td>
                      <Link href={`/admin/feedback?cat=${c.key}#app`}>{tr(c.label)}</Link>
                    </td>
                    {LEVELS.map((l) => {
                      const v = get(c.key, l);
                      return (
                        <td key={l} style={heat(v)} className={v === 0 ? "adm-zero" : undefined}>
                          {v}
                        </td>
                      );
                    })}
                    <td className="adm-strong">{rowTotal(c.key)}</td>
                  </tr>
                ))}
                <tr className="adm-total">
                  <td>{tr("Total")}</td>
                  {LEVELS.map((l) => (
                    <td key={l}>{colTotal(l)}</td>
                  ))}
                  <td>{grand}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {grand > 0 && (
          <div className="adm-status-chips">
            {Object.keys(SUGGESTION_STATUS)
              .filter((s) => byStatus.get(s))
              .map((s) => (
                <span key={s} className="adm-chip">
                  <SuggestionBadge status={s} /> {byStatus.get(s)}
                </span>
              ))}
          </div>
        )}
      </section>

      <section className="card" id="app">
        <div className="adm-row-between">
          <h2 style={{ margin: 0 }}>
            {tr("Feedback about the app")}
            {cat && ` · ${tr(categoryLabel(cat))}`}
          </h2>
          {cat && (
            <Link href="/admin/feedback#app" className="small">
              {tr("Show all")}
            </Link>
          )}
        </div>
        <p className="muted small">{tr("Shared by employees who ticked “feedback about the LeMoSp app”. Anonymous: no company or person is shown.")}</p>
        {fb.error ? (
          <p className="notice notice-error">{tr("Could not load app feedback.")}</p>
        ) : feedback.length === 0 ? (
          <p className="muted small">{tr("No app feedback yet.")}</p>
        ) : (
          <ul className="adm-feedback">
            {feedback.map((f) => (
              <li key={f.id}>
                <div className="adm-row-between">
                  <strong>{f.title}</strong>
                  <SuggestionBadge status={f.status} />
                </div>
                <div className="small muted">
                  {tr(categoryLabel(f.category))} · <LevelBadge level={f.business_level} /> · {formatDate(f.created_at)}
                </div>
                {f.body && <p className="sg-body">{f.body}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
