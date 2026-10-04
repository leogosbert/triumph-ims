import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { requireManager } from "@/lib/context";
import { loadRecommendations, type FeatureRow } from "@/lib/features";
import type { Level } from "@/lib/levels";
import { readNotice, type SearchParams } from "@/lib/messages";
import { changeLevel } from "../../growth/actions";
import { FeatureList, Stage11Notice } from "../../growth/parts";
import { LevelPicker } from "./LevelPicker";

export const metadata = { title: "Features & business level" };

export default async function FeaturesSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, features } = await requireManager();
  const level: Level = company.business_level ?? "medium";
  const recs = features.ready ? await loadRecommendations(supabase, company.id, features, level) : { list: [], ready: false };
  const recommended = new Set(recs.list.map((r) => r.feature_key).filter((k): k is string => Boolean(k)));

  // Group by module, keeping the catalogue order.
  const modules: { name: string; items: FeatureRow[] }[] = [];
  for (const f of features.list) {
    const m = modules.find((x) => x.name === f.module);
    if (m) m.items.push(f);
    else modules.push({ name: f.module, items: [f] });
  }
  const onCount = features.list.filter((f) => f.enabled).length;
  const liveCount = features.list.filter((f) => f.status === "live").length;

  return (
    <>
      <div className="page-head">
        <h1>{tr("Features & business level")}</h1>
      </div>
      <p className="muted small">
        <Link href="/settings">{tr("Settings")}</Link> · <Link href="/growth">{tr("Growth & recommendations")}</Link>
      </p>
      <Notice {...notice} />
      {!features.ready && <Stage11Notice />}

      <section className="grow-section">
        <h2>{tr("Business level")}</h2>
        <p className="muted small">
          {tr("The level sets which tools you see first. It is not a judgement of your company, and changing it never deletes data.")}
        </p>
        <LevelPicker current={level} action={changeLevel} disabled={!features.ready} />
      </section>

      {features.ready && (
        <>
          <p className="feat-summary">
            {tr("{on} of {live} available features are switched on.").replace("{on}", String(onCount)).replace("{live}", String(liveCount))}
          </p>
          {modules.map((m) => (
            <FeatureList
              key={m.name}
              title={tr(m.name)}
              features={m.items}
              isManager
              recommended={recommended}
              back="/settings/features"
            />
          ))}
        </>
      )}
    </>
  );
}
