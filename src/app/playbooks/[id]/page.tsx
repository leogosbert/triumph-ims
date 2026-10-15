import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppBackground } from "@/components/AppBackground";
import { LangSwitch } from "@/components/LangSwitch";
import { PlaybookViewer } from "@/components/playbook/PlaybookViewer";
import { getLang } from "@/lib/lang";
import { findPlaybook, PLAYBOOKS, translatePlaybook } from "@/lib/playbooks";
import { playbookAccess } from "@/lib/playbooks/access";
import { nameTheCompany, tailorPlaybook, type PlaybookProfile, type TailorResult } from "@/lib/playbooks/personalize";
import { playbookProfile } from "@/lib/playbooks/profile";
import { BUSINESS_TYPES } from "@/lib/services";
import { LEVELS } from "@/lib/levels";
import { SubmitButton } from "@/components/SubmitButton";
import { Notice } from "@/components/Notice";
import { readNotice, type SearchParams } from "@/lib/messages";
import { requestService } from "@/app/(app)/services/actions";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const p = findPlaybook((await params).id);
  return { title: p ? p.title : "Playbook", description: p?.tagline };
}

export function generateStaticParams() {
  return PLAYBOOKS.map((p) => ({ id: p.id }));
}

/**
 * One playbook, step by step (translated on the server so only this text reaches the phone).
 * Only for companies LeMo Tech has given it to; others see what is inside and can request it.
 */
export default async function PlaybookPage({ params, searchParams }: { params: Params; searchParams: SearchParams }) {
  await primeLang();
  const raw = findPlaybook((await params).id);
  if (!raw) notFound();
  const lang = await getLang();
  const access = await playbookAccess();
  const inApp = access.signedIn;
  const open = access.state(raw.id) === "granted";
  const notice = await readNotice(searchParams);
  const full = ((await searchParams) ?? {}).full === "1";
  // A given playbook is made for the reader's company: its name, size, what it sells and its features.
  const profile = open ? await playbookProfile(access.companyId) : null;
  const fit = profile ? tailorPlaybook(raw, profile, { all: full }) : null;
  let pb = translatePlaybook(fit?.pb ?? raw, lang === "sw" ? "sw" : "en", tr);
  if (profile) pb = nameTheCompany(pb, profile.name);

  return (
    <div className="auth-wrap journey-wrap pb-wrap" style={{ "--pb": raw.color } as React.CSSProperties}>
      <AppBackground kind="architecture" />
      <header className="j-head">
        <Link href="/playbooks" className="pb-back">
          ‹ {tr("All playbooks")}
        </Link>
        <LangSwitch />
      </header>
      <div className="j-intro pb-head">
        <p className="j-eyebrow">{tr("Playbook")}</p>
        <h1>{pb.title}</h1>
        <p>{pb.tagline}</p>
        <p className="pb-for">{pb.audience}</p>
      </div>
      <Notice {...notice} />
      {open && profile && fit && <MadeFor id={raw.id} profile={profile} fit={fit} full={full} />}
      {open ? (
        <PlaybookViewer pb={pb} inApp={inApp} pdfHref={`/playbooks/${raw.id}/pdf${full ? "?full=1" : ""}`} />
      ) : (
        <Locked id={raw.id} pb={pb} access={access} />
      )}
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}

/** Who the playbook was made for, what was left out and why, and the way to see all of it. */
function MadeFor({ id, profile, fit, full }: { id: string; profile: PlaybookProfile; fit: TailorResult; full: boolean }) {
  const facts = [
    profile.businessType ? tr(BUSINESS_TYPES[profile.businessType].label) : null,
    profile.level ? tr(LEVELS[profile.level].title) : null,
  ].filter(Boolean);
  const left = fit.total - fit.kept;
  return (
    <section className="pb-made-for">
      <p className="pb-made-for-name">
        {tr("Made for")} <strong>{profile.name}</strong>
      </p>
      {facts.length > 0 && <p className="small">{facts.join(" · ")}</p>}
      {fit.mostlyLarger ? (
        <p className="small">{tr("Most of this playbook is for bigger set-ups than yours today. It is shown in full so you can see what is ahead.")}</p>
      ) : full ? (
        <p className="small">
          {tr("Showing the full playbook.")} {left > 0 && tr("{n} steps do not apply to your company yet.").replace("{n}", String(left))}{" "}
          <Link href={`/playbooks/${id}`}>{tr("Show only what fits my company")}</Link>
        </p>
      ) : (
        <p className="small">
          {tr("{kept} of {total} steps fit your company.").replace("{kept}", String(fit.kept)).replace("{total}", String(fit.total))}{" "}
          {fit.switchedOff > 0 && tr("{n} are for features you have switched off.").replace("{n}", String(fit.switchedOff))}{" "}
          {fit.larger > 0 && tr("{n} are for bigger businesses.").replace("{n}", String(fit.larger))}{" "}
          {left > 0 && <Link href={`/playbooks/${id}?full=1`}>{tr("Show the full playbook")}</Link>}
        </p>
      )}
      <p className="small muted">
        {tr("It follows how your company is set up in LeMoSp. When you change what you sell, your level or your features, the playbook changes with it.")}{" "}
        <Link href="/settings/features">{tr("Features & business level")}</Link>
      </p>
    </section>
  );
}

/** What is inside, and how to get it: request it for the company, or sign in first. */
function Locked({ id, pb, access }: { id: string; pb: ReturnType<typeof translatePlaybook>; access: Awaited<ReturnType<typeof playbookAccess>> }) {
  const state = access.state(id);
  const key = access.itemKey(id);
  const note = access.note(id);
  return (
    <section className="pr-list">
      <h2>{tr("What is inside")}</h2>
      <ol className="small">
        {pb.chapters.map((c) => (
          <li key={c.id}>
            <strong>{c.title}</strong>
            {c.intro ? ` · ${c.intro}` : ""}
          </li>
        ))}
      </ol>
      {!access.signedIn ? (
        <p>
          <Link className="btn btn-primary" href="/login">
            {tr("Sign in to request this playbook")}
          </Link>
        </p>
      ) : !access.companyId ? (
        <p className="muted">{tr("Create or join a company first. Playbooks are given to companies.")}</p>
      ) : state === "requested" ? (
        <p className="badge tone-warn">{tr("Requested: the LeMo Tech team will reply in the app.")}</p>
      ) : !key ? (
        <p className="muted">{tr("This playbook is not offered at the moment.")}</p>
      ) : (
        <form action={requestService} className="pb-request">
          {state === "declined" && note && (
            <p className="small">
              <strong>{tr("LeMo Tech:")}</strong> {note}
            </p>
          )}
          <input type="hidden" name="item" value={key} />
          <input type="hidden" name="back" value={`/playbooks/${id}`} />
          <label htmlFor="pb-note">{tr("Note for LeMo Tech (optional)")}</label>
          <textarea id="pb-note" name="note" maxLength={1000} placeholder={tr("Who will use it and why")} />
          <SubmitButton className="btn btn-primary" pendingText={tr("Sending…")}>
            {tr("Request this playbook")}
          </SubmitButton>
          <p className="small muted">
            {tr("Prices are in")} <Link href="/services#playbook">{tr("Services & prices")}</Link>.
          </p>
        </form>
      )}
    </section>
  );
}
