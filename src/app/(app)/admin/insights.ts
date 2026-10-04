import { tr } from "@/lib/tr";
import { CATEGORY_AREA, categoryLabel, LEVEL_LABEL, LEVELS } from "@/components/suggestions/meta";

export type FeedbackStat = { category: string; business_level: string; status: string; n: number | string };
export type Adoption = {
  key: string;
  name: string;
  default_level: string;
  status: string;
  enabled_companies: number;
  total_companies: number;
};
export type Insight = { tone: "info" | "warn" | "ok"; text: string };

const LEVEL_PLURAL: Record<string, string> = {
  small: "small suppliers",
  medium: "medium suppliers",
  enterprise: "enterprise suppliers",
};

const num = (v: unknown) => Number(v) || 0;

/**
 * Turns aggregated, anonymous feedback and feature adoption into plain recommendations
 * for the LeMo Tech product team. Never uses company names or authors.
 */
export function productInsights(
  stats: FeedbackStat[],
  adoption: Adoption[],
  byLevel?: Record<string, number> | null,
): Insight[] {
  const out: Insight[] = [];

  // 1. The most common topic per business level.
  for (const level of LEVELS) {
    const rows = stats.filter((r) => r.business_level === level);
    const total = rows.reduce((s, r) => s + num(r.n), 0);
    if (total < 3) continue;
    const byCat = new Map<string, number>();
    for (const r of rows) byCat.set(r.category, (byCat.get(r.category) ?? 0) + num(r.n));
    const [cat, n] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    const share = Math.round((n / total) * 100);
    if (share < 20) continue;
    out.push({
      tone: share >= 35 ? "warn" : "info",
      text: `${tr("Many")} ${tr(LEVEL_PLURAL[level])} ${tr("write about")} ${tr(categoryLabel(cat))} (${n} ${tr("of")} ${total}, ${share}%). ${tr("Consider improving")} ${tr(CATEGORY_AREA[cat] ?? "this area")} ${tr("and its tutorials.")}`,
    });
  }

  // 2. A topic that comes up at every level points to a platform-wide gap.
  const levelsPerCat = new Map<string, Set<string>>();
  for (const r of stats) {
    if (num(r.n) <= 0) continue;
    if (!levelsPerCat.has(r.category)) levelsPerCat.set(r.category, new Set());
    levelsPerCat.get(r.category)!.add(r.business_level);
  }
  for (const [cat, levels] of levelsPerCat) {
    if (levels.size === LEVELS.length && cat !== "other") {
      out.push({
        tone: "info",
        text: `${tr(categoryLabel(cat))}: ${tr("raised by small, medium and enterprise suppliers alike — a platform-wide priority.")}`,
      });
    }
  }

  // 3. Many unanswered ideas: companies may need help running their Suggestion Box.
  const waiting = stats.filter((r) => r.status === "submitted").reduce((s, r) => s + num(r.n), 0);
  const all = stats.reduce((s, r) => s + num(r.n), 0);
  if (all >= 10 && waiting / all >= 0.5) {
    out.push({
      tone: "warn",
      text: `${Math.round((waiting / all) * 100)}% ${tr("of suggestions are still waiting for a manager's review. Consider reminders or a short tutorial for owners on handling suggestions.")}`,
    });
  }

  // 4. Live features that companies at (or above) the feature's level have switched off:
  //    a discovery or ease-of-use problem. Companies below the level are not counted.
  const rank = (l: string) => LEVELS.indexOf(l as (typeof LEVELS)[number]);
  const lowUse = adoption
    .filter((a) => a.status === "live")
    .map((a) => {
      const eligible = byLevel
        ? LEVELS.filter((l) => rank(l) >= rank(a.default_level)).reduce((s, l) => s + num(byLevel[l]), 0)
        : num(a.total_companies);
      const pct = eligible > 0 ? Math.min(100, Math.round((num(a.enabled_companies) / eligible) * 100)) : 100;
      return { ...a, eligible, pct };
    })
    .filter((a) => a.eligible >= 5 && a.pct < 50)
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3);
  for (const a of lowUse) {
    out.push({
      tone: "info",
      text: `${a.name}: ${tr("only")} ${a.pct}% ${tr("of the companies it is meant for have it on (level")} ${tr(LEVEL_LABEL[a.default_level] ?? a.default_level)}${tr(" and up). Check whether it is easy to find and understand; a better tutorial may help.")}`,
    });
  }

  if (out.length === 0) {
    out.push({ tone: "ok", text: tr("Not enough feedback yet for clear patterns. Insights appear as companies send suggestions.") });
  }
  return out;
}
