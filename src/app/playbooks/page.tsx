import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { AppBackground } from "@/components/AppBackground";
import { Icon } from "@/components/Icon";
import { LangSwitch } from "@/components/LangSwitch";
import { getLang } from "@/lib/lang";
import { PLAYBOOKS, scenarioCount, stepCount, translatePlaybook } from "@/lib/playbooks";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/user";

export const metadata = {
  title: "Playbooks",
  description: "Step-by-step LeMoSp playbooks with examples and real business scenarios: setting up, order to payment, numbers and decisions, getting paid, stock, routines and security.",
};

/** Public list of the playbooks (src/lib/playbooks), each with "Read" and "Download PDF". */
export default async function PlaybooksPage() {
  await primeLang();
  const lang = await getLang();
  const inApp = Boolean(await getSessionUser(await createClient()));
  const books = PLAYBOOKS.map((p) => ({ raw: p, t: translatePlaybook(p, lang === "sw" ? "sw" : "en", tr) }));

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
        <p>{tr("Step-by-step guides with live examples and real business situations. Read them on screen with animations, or download each one as a PDF to print and share with your team.")}</p>
      </div>
      <ul className="pb-cards">
        {books.map(({ raw, t }, i) => (
          <li key={raw.id} style={{ "--i": i, "--c": raw.color } as React.CSSProperties}>
            <Link href={`/playbooks/${raw.id}`} className="pb-card">
              <span className="pb-card-icon">
                <Icon name={raw.icon} size={24} />
              </span>
              <strong>{t.title}</strong>
              <span className="pb-card-tag">{t.tagline}</span>
              <span className="pb-card-meta">
                {raw.chapters.length} {tr("chapters")} · {stepCount(raw)} {tr("steps")} · {scenarioCount(raw)} {tr("scenarios")} · ~{raw.minutes} {tr("min")}
              </span>
              <span className="pb-card-for">{t.audience}</span>
            </Link>
            <a className="pb-card-pdf" href={`/playbooks/${raw.id}/pdf`} download>
              ⬇ {tr("PDF")}
            </a>
          </li>
        ))}
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
