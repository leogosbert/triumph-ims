import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppBackground } from "@/components/AppBackground";
import { LangSwitch } from "@/components/LangSwitch";
import { PlaybookViewer } from "@/components/playbook/PlaybookViewer";
import { getLang } from "@/lib/lang";
import { findPlaybook, PLAYBOOKS, translatePlaybook } from "@/lib/playbooks";
import { playbookAccess } from "@/lib/playbooks/access";
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
  const pb = translatePlaybook(raw, lang === "sw" ? "sw" : "en", tr);
  const access = await playbookAccess();
  const inApp = access.signedIn;
  const open = access.state(raw.id) === "granted";
  const notice = await readNotice(searchParams);

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
      {open ? (
        <PlaybookViewer pb={pb} inApp={inApp} pdfHref={`/playbooks/${raw.id}/pdf`} />
      ) : (
        <Locked id={raw.id} pb={pb} access={access} />
      )}
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
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
