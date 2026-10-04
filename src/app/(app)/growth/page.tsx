import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { FeatureTutorial } from "@/components/FeatureTutorial";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { loadRecommendations, type FeatureRow, type Recommendation } from "@/lib/features";
import { LEVELS, levelRank, nextLevel, type Level } from "@/lib/levels";
import { readNotice, type SearchParams } from "@/lib/messages";
import { respondRecommendation, runGrowthCheck } from "./actions";
import { FeatureList, levelTutorial, Stage11Notice, tutorialOf } from "./parts";

export const metadata = { title: "Growth & recommendations" };

function RecActions({
  ids,
  acceptLabel,
  tutorial,
}: {
  ids: string[];
  acceptLabel: string;
  tutorial: React.ReactNode;
}) {
  const hidden = (
    <>
      <input type="hidden" name="ids" value={ids.join(",")} />
      <input type="hidden" name="back" value="/growth" />
    </>
  );
  return (
    <div className="grow-rec-actions">
      {tutorial}
      <form action={respondRecommendation}>
        {hidden}
        <input type="hidden" name="action" value="accept" />
        <SubmitButton className="btn btn-primary btn-small" pendingText={tr("Working…")}>
          {acceptLabel}
        </SubmitButton>
      </form>
      <form action={respondRecommendation}>
        {hidden}
        <input type="hidden" name="action" value="postpone" />
        <SubmitButton className="btn btn-small" pendingText={tr("Saving…")}>
          {tr("Remind me in 2 weeks")}
        </SubmitButton>
      </form>
      <form action={respondRecommendation}>
        {hidden}
        <input type="hidden" name="action" value="dismiss" />
        <SubmitButton className="btn btn-small btn-ghost" pendingText={tr("Saving…")}>
          {tr("Dismiss")}
        </SubmitButton>
      </form>
    </div>
  );
}

export default async function GrowthPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, isManager, features } = await getAppContext();
  const level: Level = company.business_level ?? "medium";
  const info = LEVELS[level];
  const next = nextLevel(level);

  // Managers: look at recent activity (the database limits this to once every 10 minutes).
  if (isManager && features.ready) {
    try {
      await supabase.rpc("run_growth_check", { p_company: company.id, p_force: false });
    } catch {
      /* the scheduled check covers it */
    }
  }
  const recs = isManager ? await loadRecommendations(supabase, company.id, features, level) : { list: [] as Recommendation[], ready: false };
  // Opened: "new" becomes "seen" (the New label stays on this visit).
  const fresh = recs.list.filter((r) => r.status === "new");
  if (fresh.length > 0) {
    await Promise.all(
      fresh.map(async (r) => {
        try {
          await supabase.rpc("respond_recommendation", { p_id: r.id, p_action: "seen", p_days: 14 });
        } catch {
          /* not important */
        }
      }),
    );
  }

  const byKey = new Map<string, FeatureRow>(features.list.map((f) => [f.key, f]));
  const levelRecs = new Map<Level, Recommendation[]>();
  for (const r of recs.list) {
    if (!r.target_level) continue;
    levelRecs.set(r.target_level, [...(levelRecs.get(r.target_level) ?? []), r]);
  }
  const featureRecs = recs.list.filter((r) => r.feature_key && byKey.has(r.feature_key));
  const recommended = new Set(featureRecs.map((r) => r.feature_key as string));
  for (const lvl of levelRecs.keys()) {
    for (const f of features.list) if (f.default_level === lvl && f.status === "live" && !f.enabled) recommended.add(f.key);
  }

  const atLevel = features.list.filter((f) => f.status === "live" && levelRank(f.default_level) <= levelRank(level));
  const above = features.list.filter((f) => f.status === "live" && levelRank(f.default_level) > levelRank(level));
  const planned = features.list.filter((f) => f.status !== "live");
  const back = "/growth" as const;

  return (
    <>
      <div className="page-head">
        <h1>{tr("Growth & recommendations")}</h1>
      </div>
      <Notice {...notice} />

      <section className="grow-level" aria-labelledby="grow-level-title">
        <span className="grow-kicker">{tr("Your business level")}</span>
        <h2 id="grow-level-title">
          {level === "small"
            ? tr("Your business is currently operating at Small Level")
            : level === "medium"
              ? tr("Your business is currently operating at Medium Level")
              : tr("Your business is currently operating at Enterprise Level")}
        </h2>
        <p>{tr(info.promise)}</p>
        <div className="grow-steps" aria-hidden="true">
          {(["small", "medium", "enterprise"] as Level[]).map((l) => (
            <span key={l} className={levelRank(l) <= levelRank(level) ? "done" : undefined}>
              {tr(LEVELS[l].name)}
            </span>
          ))}
        </div>
        {next && (
          <p className="grow-next">
            <strong>{tr("Next level")}:</strong> {tr(LEVELS[next].name)} — {tr(LEVELS[next].promise)}
          </p>
        )}
        <p className="grow-note">{tr("The level is not a judgement of your company. It only sets which tools you see first.")}</p>
        {isManager && (
          <div className="grow-level-actions">
            {features.ready && (
              <form action={runGrowthCheck}>
                <input type="hidden" name="back" value="/growth" />
                <SubmitButton className="btn btn-small grow-btn-light" pendingText={tr("Checking…")}>
                  {tr("Check now")}
                </SubmitButton>
              </form>
            )}
            <Link href="/settings/features" className="btn btn-small grow-btn-outline">
              {tr("Change level or features")}
            </Link>
          </div>
        )}
      </section>

      {isManager && !features.ready && <Stage11Notice />}

      {!isManager && (
        <p className="card muted small">
          {tr(
            "Only managers can switch features on or change the business level. If a feature below would help your work, tell your manager or send an idea through the Suggestion Box.",
          )}
        </p>
      )}

      {isManager && features.ready && (
        <section className="grow-section">
          <h2>{tr("Recommended for you")}</h2>
          {recs.list.length === 0 ? (
            <p className="card muted small">
              {tr("No recommendations right now. LeMoSp looks at your activity regularly — tap Check now any time.")}
            </p>
          ) : (
            <>
              {[...levelRecs.entries()].map(([lvl, rs]) => (
                <article key={lvl} className="grow-rec grow-rec-level">
                  <div className="grow-rec-head">
                    <span className="badge tone-info">{tr("Next level suggestion")}</span>
                    {rs.some((r) => r.status === "new") && <span className="badge tone-warn">{tr("New")}</span>}
                  </div>
                  <h3>
                    {lvl === "medium" ? tr("Your business may be ready for Medium level") : tr("Your business may be ready for Enterprise level")}
                  </h3>
                  <p className="muted small">{tr(LEVELS[lvl].promise)}</p>
                  <strong className="grow-rec-sub">{tr("Why we suggest it")}</strong>
                  <ul className="grow-reasons">
                    {rs.map((r) => (
                      <li key={r.id}>{r.reason ?? r.title}</li>
                    ))}
                  </ul>
                  {features.list.some((f) => f.default_level === lvl && f.status === "live") && (
                    <>
                      <strong className="grow-rec-sub">{tr("What you would get")}</strong>
                      <ul className="grow-chips">
                        {features.list
                          .filter((f) => f.default_level === lvl && f.status === "live")
                          .map((f) => (
                            <li key={f.key}>
                              <a href={`#${f.key}`}>{tr(f.name)}</a>
                            </li>
                          ))}
                      </ul>
                    </>
                  )}
                  <p className="muted small">{tr("Nothing is deleted when you move up, and you can move back at any time.")}</p>
                  <RecActions
                    ids={rs.map((r) => r.id)}
                    acceptLabel={lvl === "medium" ? tr("Move to Medium") : tr("Move to Enterprise")}
                    tutorial={<FeatureTutorial data={levelTutorial(lvl, features.list)} />}
                  />
                </article>
              ))}

              {featureRecs.map((r) => {
                const f = byKey.get(r.feature_key as string) as FeatureRow;
                return (
                  <article key={r.id} className="grow-rec">
                    <div className="grow-rec-head">
                      <span className="badge tone-ok">{tr("Feature suggestion")}</span>
                      {f.default_level !== "small" && (
                        <span className="badge tone-off">
                          {f.default_level === "medium" ? tr("Available in Medium Mode") : tr("Available in Enterprise Mode")}
                        </span>
                      )}
                      {r.status === "new" && <span className="badge tone-warn">{tr("New")}</span>}
                    </div>
                    <h3>{tr(f.name)}</h3>
                    {r.reason && <p>{r.reason}</p>}
                    {f.benefits && (
                      <p className="grow-benefit">
                        <strong>{tr("How it helps")}:</strong> {tr(f.benefits)}
                      </p>
                    )}
                    <RecActions ids={[r.id]} acceptLabel={tr("Switch on")} tutorial={<FeatureTutorial data={tutorialOf(f)} />} />
                  </article>
                );
              })}
            </>
          )}
        </section>
      )}

      {features.ready && (
        <>
          <FeatureList
            title={tr("Features at your level")}
            sub={tr("Included in your level. Managers can switch any of them off or on.")}
            features={atLevel}
            isManager={isManager}
            recommended={recommended}
            back={back}
          />
          <FeatureList
            title={next === "enterprise" ? tr("Enterprise level features") : tr("Next level features")}
            sub={tr("Ready to use. Switch one on when your business needs it — you do not have to change level.")}
            features={above}
            isManager={isManager}
            recommended={recommended}
            back={back}
          />
          <FeatureList
            title={tr("Coming soon")}
            sub={tr("Being built. They will appear here as your business grows.")}
            features={planned}
            isManager={isManager}
            recommended={recommended}
            back={back}
          />
        </>
      )}

      {!features.ready && (
        <section className="grow-section">
          <h2>{tr("What each level gives you")}</h2>
          <div className="lvl-grid">
            {(["small", "medium", "enterprise"] as Level[]).map((l) => (
              <div key={l} className={`lvl-card${l === level ? " current" : ""}`}>
                <strong>{tr(LEVELS[l].title)}</strong>
                <p className="small">{tr(LEVELS[l].promise)}</p>
                <ul className="small">
                  {LEVELS[l].modules.map((m) => (
                    <li key={m}>{tr(m)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
