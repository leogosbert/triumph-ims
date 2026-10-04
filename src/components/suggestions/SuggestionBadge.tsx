import { tr } from "@/lib/tr";
import { LEVEL_LABEL, SUGGESTION_STATUS } from "@/components/suggestions/meta";

/** Status pill for a suggestion (server components only). */
export function SuggestionBadge({ status }: { status: string }) {
  const s = SUGGESTION_STATUS[status] ?? { label: status, tone: "off" };
  return <span className={`badge tone-${s.tone} sg-st-${status}`}>{tr(s.label)}</span>;
}

/** Business-level pill (server components only). */
export function LevelBadge({ level }: { level: string | null | undefined }) {
  if (!level) return null;
  return <span className={`badge adm-lvl adm-lvl-${level}`}>{tr(LEVEL_LABEL[level] ?? level)}</span>;
}
