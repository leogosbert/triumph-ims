import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { AppBackground } from "@/components/AppBackground";
import { Icon } from "@/components/Icon";
import { LangSwitch } from "@/components/LangSwitch";
import { getLang } from "@/lib/lang";
import { PLAYBOOKS, scenarioCount, stepCount, translatePlaybook } from "@/lib/playbooks";
import { playbookAccess } from "@/lib/playbooks/access";
import { recommendedFor, tailorPlaybook } from "@/lib/playbooks/personalize";
import { playbookProfile } from "@/lib/playbooks/profile";

export const metadata = {
  title: "Playbooks",
  description: "Step-by-step LeMoSp playbooks with examples and real business scenarios. Each company requests the playbooks it needs from LeMo Tech.",
};

/**
 * The list of playbooks (src/lib/playbooks). Everyone sees the list; a playbook opens once LeMo Tech has
 * given it to the company (requested from here or from Services & prices).
 */
export default async function PlaybooksPage() {
  await primeLang();
  const lang = await getLang();
  const access = await playbookAccess();
  const inApp = access.signedIn;
  const profile = await playbookProfile(access.companyId);
  const picks = profile ? recommendedFor(profile) : new Set<string>();
  // Each playbook as it would be for this company (its size and features), the best fits first.
  const books = PLAYBOOKS.map((p) => ({ raw: p, fit: profile ? tailorPlaybook(p, profile).pb : p, t: translatePlaybook(p, lang === "sw" ? "sw" : "en", tr) })).sort(
    (a, b) => Number(picks.has(b.raw.id)) - Number(picks.has(a.raw.id)),
  );

  return (
    <div className="auth-wrap journey-wrap pb-list-wrap">
      <AppBackground kind="architecture" />
      <header className="j-head">
        <Link href={inApp ? "/" : "/login"} className="j-logo" aria-label={tr("LeMoSp")}>
          <img src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
        </Link>
        <LangSwitch />
      </header>
      <div className="j-intro">
        <p className="j-eyebrow">{tr("Playbooks")}</p>
        <h1>{tr("Learn LeMoSp the practical way")}</h1>
        <p>{tr("Step-by-step guides with live examples and real business situations. Choose the playbooks your company needs and request them: once LeMo Tech gives them to your company, everyone in your team can read them on screen or download the PDF.")}</p>
        {profile?.name && (
          <p className="small">
            {tr("Each playbook is made for {company}: your name in the examples, and only the steps that fit your size, what you sell and the features you use.").replace("{company}", profile.name)}
          </p>
        )}
        {!inApp && <p className="small">{tr("Sign in to request playbooks for your company.")}</p>}
      </div>
      <ul className="pb-cards">
        {books.map(({ raw, fit, t }, i) => {
          const state = access.state(raw.id);
          const open = state === "granted";
          return (
            <li key={raw.id} style={{ "--i": i, "--c": raw.color } as React.CSSProperties} className={open ? undefined : "pb-locked"}>
              <Link href={inApp ? `/playbooks/${raw.id}` : "/login"} className="pb-card">
                <span className="pb-card-icon">
                  <Icon name={open ? raw.icon : "lock"} size={24} />
                </span>
                <strong>{t.title}</strong>
                <span className="pb-card-tag">{t.tagline}</span>
                <span className="pb-card-meta">
                  {fit.chapters.length} {tr("chapters")} · {stepCount(fit)} {tr("steps")} · {scenarioCount(fit)} {tr("scenarios")} · ~{fit.minutes} {tr("min")}
                </span>
                {picks.has(raw.id) && (
                  <span className="pb-card-for">
                    <span className="badge tone-info">★ {tr("Recommended for your company")}</span>
                  </span>
                )}
                <span className="pb-card-for">{t.audience}</span>
                <span className="pb-card-for">
                  {open ? (
                    <span className="badge tone-ok">{tr("Your company has this playbook")}</span>
                  ) : state === "requested" ? (
                    <span className="badge tone-warn">{tr("Requested: waiting for LeMo Tech")}</span>
                  ) : state === "declined" ? (
                    <span className="badge tone-bad">{tr("Not given yet: you can ask again")}</span>
                  ) : (
                    <span className="badge tone-info">{inApp ? tr("Tap to see it and request it") : tr("Sign in to request")}</span>
                  )}
                </span>
              </Link>
              {open && (
                <a className="pb-card-pdf" href={`/playbooks/${raw.id}/pdf`} download>
                  ⬇ {tr("PDF")}
                </a>
              )}
            </li>
          );
        })}
      </ul>
      <p className="auth-links">
        <Link href="/how-it-works">{tr("New here? See how LeMoSp works, step by step")} ›</Link>
      </p>
      {inApp && (
        <p className="auth-links">
          <Link href="/">{tr("Back to the app")}</Link>
        </p>
      )}
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
