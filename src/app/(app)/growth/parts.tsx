import { tr } from "@/lib/tr";
import { FeatureTutorial, type TutorialData } from "@/components/FeatureTutorial";
import { CORE_FEATURES, sourceLabel, type FeatureRow } from "@/lib/features";
import { LEVELS, type Level } from "@/lib/levels";
import { availabilityLabel } from "@/lib/menu";
import { toggleFeature } from "./actions";

/** Shared pieces of the Growth page and Settings → Features. Server components (call primeLang() first). */

export function tutorialOf(f: FeatureRow): TutorialData {
  return { title: f.name, description: f.description, audience: f.audience, benefits: f.benefits, steps: f.tutorial };
}

/** A guided look at a whole level: one step per live feature that comes with it. */
export function levelTutorial(level: Level, features: FeatureRow[]): TutorialData {
  const info = LEVELS[level];
  const steps = features
    .filter((f) => f.default_level === level && f.status === "live")
    .slice(0, 8)
    .map((f) => ({ title: f.name, body: f.description ?? f.benefits ?? "" }));
  return { title: info.title, description: info.promise, audience: info.forWho, benefits: null, steps };
}

export function Stage11Notice() {
  return (
    <p className="notice notice-error grow-setup" role="status">
      <span className="notice-icon" aria-hidden>
        !
      </span>
      <span>
        {tr("Run the Stage 11 database update")}
        {" — "}
        {tr("until then every screen stays visible and growth recommendations are off. (Managers only see this note.)")}
      </span>
    </p>
  );
}

/** One feature: name, what it does, on/off state, where that state comes from, tutorial and switch. */
export function FeatureItem({
  f,
  isManager,
  recommended = false,
  back,
}: {
  f: FeatureRow;
  isManager: boolean;
  recommended?: boolean;
  back: "/growth" | "/settings/features";
}) {
  const live = f.status === "live";
  const canSwitch = isManager && live && !CORE_FEATURES.has(f.key);
  return (
    <li id={f.key} className={`feat${f.enabled ? " on" : ""}${live ? "" : " soon"}${recommended ? " rec" : ""}`}>
      <div className="feat-main">
        <div className="feat-name">
          <strong>{tr(f.name)}</strong>
          {recommended && <span className="badge tone-warn">{tr("Recommended next step")}</span>}
        </div>
        {f.description && <p className="feat-desc">{tr(f.description)}</p>}
        <div className="feat-meta">
          {live ? (
            f.enabled ? (
              <span className="badge tone-ok">{tr("On")}</span>
            ) : (
              <span className="badge tone-off">{tr("Off")}</span>
            )
          ) : (
            <span className="badge tone-info">{tr("Coming soon")}</span>
          )}
          {live && !f.enabled && f.source === "level" && <span className="feat-src">{tr(availabilityLabel(f))}</span>}
          {live && (f.enabled || f.source !== "level") && <span className="feat-src">{tr(sourceLabel(f))}</span>}
          {f.audience && <span className="feat-src">· {tr(f.audience)}</span>}
        </div>
        {(f.tutorial.length > 0 || f.benefits) && (
          <div className="feat-actions">
            <FeatureTutorial data={tutorialOf(f)} className="btn btn-small btn-ghost" />
          </div>
        )}
      </div>
      {canSwitch && (
        <form action={toggleFeature} className="feat-switch">
          <input type="hidden" name="key" value={f.key} />
          <input type="hidden" name="enabled" value={f.enabled ? "false" : "true"} />
          <input type="hidden" name="back" value={back} />
          <button
            type="submit"
            className="fswitch"
            role="switch"
            aria-checked={f.enabled}
            aria-label={`${tr(f.name)}: ${f.enabled ? tr("switch off") : tr("switch on")}`}
          >
            <span className="fswitch-knob" />
          </button>
        </form>
      )}
    </li>
  );
}

export function FeatureList({
  title,
  sub,
  features,
  isManager,
  recommended,
  back,
}: {
  title: string;
  sub?: string;
  features: FeatureRow[];
  isManager: boolean;
  recommended: Set<string>;
  back: "/growth" | "/settings/features";
}) {
  if (features.length === 0) return null;
  return (
    <section className="grow-section">
      <h2>{title}</h2>
      {sub && <p className="muted small">{sub}</p>}
      <ul className="feat-list">
        {features.map((f) => (
          <FeatureItem key={f.key} f={f} isManager={isManager} recommended={recommended.has(f.key)} back={back} />
        ))}
      </ul>
    </section>
  );
}
