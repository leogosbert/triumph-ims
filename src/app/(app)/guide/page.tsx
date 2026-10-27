import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { GuideView, type GuideViewSection } from "@/components/GuideView";
import { getAppContext } from "@/lib/context";
import { GUIDE } from "@/lib/guide";
import { ROLE_LABELS, type Role, hasRole } from "@/lib/roles";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "App guide" };

export default async function GuidePage() {
  await primeLang();
  const { role, roles, features, company } = await getAppContext();
  const who = (r: Role[] | "all" | "managers") =>
    r === "all" ? tr("Everyone") : r === "managers" ? tr(ROLE_LABELS.management) : r.map((x) => tr(ROLE_LABELS[x])).join(", ");
  const mine = (r: Role[] | "all" | "managers") => r === "all" || (r === "managers" ? hasRole(roles, "management") : hasRole(roles, ...r));
  const sections: GuideViewSection[] = GUIDE.map((s) => ({
    id: s.id,
    title: tr(s.title),
    intro: tr(s.intro),
    topics: s.topics.map((t) => ({
      id: t.id,
      title: tr(t.title),
      summary: tr(t.summary),
      phone: t.phone.map(tr).join(" → "),
      laptop: t.laptop.map(tr).join(" → "),
      href: t.href ?? null,
      who: who(t.roles),
      yours: mine(t.roles),
      off: Boolean(t.feature && !features.on(t.feature)),
      steps: t.steps.map(tr),
      tips: (t.tips ?? []).map(tr),
    })),
  }));
  return (
    <>
      <BackLink href="/help" label="Help" />
      <Link href="/how-it-works" className="tile guide-journey no-print">
        <span className="tile-title">{tr("How it works: one order, step by step")}</span>
        <span className="tile-sub">{tr("Follow an order from the first call with a customer to the agreed terms, delivery, payment and profit, with animations. Press Next to move on.")}</span>
      </Link>
      <Link href="/playbooks" className="tile guide-journey guide-playbooks no-print">
        <span className="tile-title">{tr("Playbooks: long step-by-step guides, with PDFs")}</span>
        <span className="tile-sub">{tr("Set up the app, run an order from request to payment, use your numbers to decide, get paid on time, control stock, daily routines and security. With examples and real business situations.")}</span>
      </Link>
      <GuideView sections={sections} company={company.name} roleLabel={tr(ROLE_LABELS[role])} />
    </>
  );
}
