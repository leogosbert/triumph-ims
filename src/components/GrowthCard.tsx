import Link from "next/link";
import { tr } from "@/lib/tr";
import { Icon } from "@/components/Icon";
import { LEVELS, type Level } from "@/lib/levels";

/**
 * Home page (managers): "Your business is at Medium level" and how many features could help now.
 * Hidden when there is nothing to suggest. Server component — the page calls primeLang() first.
 */
export function GrowthCard({
  level,
  featureRecs,
  featureLevel,
  levelRec,
}: {
  level: Level;
  /** Open feature recommendations. */
  featureRecs: number;
  /** The level those features belong to, when they all belong to one level above the company's. */
  featureLevel: Level | null;
  /** An open suggestion to move up a level. */
  levelRec: Level | null;
}) {
  if (featureRecs === 0 && !levelRec) return null;
  const levelLine =
    level === "small"
      ? tr("Your business is at Small level")
      : level === "medium"
        ? tr("Your business is at Medium level")
        : tr("Your business is at Enterprise level");
  const levelName = featureLevel ? tr(LEVELS[featureLevel].name) : "";
  const template = featureLevel
    ? featureRecs === 1
      ? tr("Based on your recent activity, you may benefit from 1 {level} feature.")
      : tr("Based on your recent activity, you may benefit from {n} {level} features.")
    : featureRecs === 1
      ? tr("Based on your recent activity, you may benefit from 1 more feature.")
      : tr("Based on your recent activity, you may benefit from {n} more features.");
  return (
    <Link href="/growth" className="growth-card">
      <span className="growth-card-ico" aria-hidden="true">
        <Icon name="activity" size={22} />
      </span>
      <span className="growth-card-txt">
        <strong>{levelLine}</strong>
        {featureRecs > 0 ? (
          <span>{template.replace("{n}", String(featureRecs)).replace("{level}", levelName)}</span>
        ) : (
          <span>
            {levelRec === "enterprise"
              ? tr("Based on your recent activity, your business may be ready for Enterprise level.")
              : tr("Based on your recent activity, your business may be ready for Medium level.")}
          </span>
        )}
        <span className="growth-card-cta">{tr("See recommendations")}</span>
      </span>
      <Icon name="chevron" size={18} />
    </Link>
  );
}

/** Home page (managers of a company that has not finished setup): open the onboarding questions. */
export function OnboardingCard() {
  return (
    <Link href="/onboarding" className="growth-card onboarding-card">
      <span className="growth-card-ico" aria-hidden="true">
        <Icon name="check" size={22} />
      </span>
      <span className="growth-card-txt">
        <strong>{tr("Set up your workspace in 2 minutes")}</strong>
        <span>{tr("Answer a few short questions and LeMoSp suggests the right starting level for your business.")}</span>
        <span className="growth-card-cta">{tr("Start")}</span>
      </span>
      <Icon name="chevron" size={18} />
    </Link>
  );
}

/** Home page right after onboarding: the first things to do at the chosen level. */
export function FirstStepsCard({ level }: { level: Level }) {
  const info = LEVELS[level];
  return (
    <section className="card first-steps">
      <h2>
        {level === "small"
          ? tr("Welcome to your Small level workspace")
          : level === "medium"
            ? tr("Welcome to your Medium level workspace")
            : tr("Welcome to your Enterprise level workspace")}
      </h2>
      <p className="muted small">{tr("What to do first")}</p>
      <ol className="first-steps-list">
        {info.firstSteps.map((s) => (
          <li key={s.href}>
            <Link href={s.href}>{tr(s.label)}</Link>
          </li>
        ))}
      </ol>
      <p className="muted small">
        {tr("You can change your level or switch single features on at any time in")}{" "}
        <Link href="/settings/features">{tr("Features & business level")}</Link>.
      </p>
    </section>
  );
}
