import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppBackground } from "@/components/AppBackground";
import { LangSwitch } from "@/components/LangSwitch";
import { PlaybookViewer } from "@/components/playbook/PlaybookViewer";
import { getLang } from "@/lib/lang";
import { findPlaybook, PLAYBOOKS, translatePlaybook } from "@/lib/playbooks";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/user";

type Params = Promise<{ id: string }>;

export async function generateMetadata({ params }: { params: Params }) {
  const p = findPlaybook((await params).id);
  return { title: p ? p.title : "Playbook", description: p?.tagline };
}

export function generateStaticParams() {
  return PLAYBOOKS.map((p) => ({ id: p.id }));
}

/** One playbook, step by step (translated on the server so only this text reaches the phone). */
export default async function PlaybookPage({ params }: { params: Params }) {
  await primeLang();
  const raw = findPlaybook((await params).id);
  if (!raw) notFound();
  const lang = await getLang();
  const pb = translatePlaybook(raw, lang === "sw" ? "sw" : "en", tr);
  const inApp = Boolean(await getSessionUser(await createClient()));

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
      <PlaybookViewer pb={pb} inApp={inApp} pdfHref={`/playbooks/${raw.id}/pdf`} />
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
