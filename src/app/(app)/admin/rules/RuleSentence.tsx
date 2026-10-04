import { tr } from "@/lib/tr";
import { LEVEL_LABEL } from "@/components/suggestions/meta";
import { metricLabel, OP_LABEL } from "./meta";

export type Rule = {
  key: string;
  title: string;
  metric: string;
  op: string;
  threshold: number;
  feature_key: string | null;
  target_level: string | null;
  applies_to: string[] | null;
  message: string | null;
  active: boolean;
  sort: number;
};

const fmt = (v: unknown) => (Number(v) || 0).toLocaleString("en-GB");

/** "When Products reaches 150 for companies at Small level, recommend Reorder levels." (server only) */
export function RuleSentence({ r, featureName }: { r: Rule; featureName: string }) {
  const levels = (r.applies_to ?? []).map((l) => tr(LEVEL_LABEL[l] ?? l)).join(", ");
  return (
    <>
      {tr("When")} <strong>{tr(metricLabel(r.metric))}</strong> {tr(OP_LABEL[r.op] ?? r.op)} <strong>{fmt(r.threshold)}</strong>{" "}
      {tr("for companies at")} <strong>{levels || "—"}</strong> {tr("level, recommend")}{" "}
      <strong>{r.target_level ? `${tr("moving to")} ${tr(LEVEL_LABEL[r.target_level] ?? r.target_level)}` : featureName}</strong>.
    </>
  );
}
