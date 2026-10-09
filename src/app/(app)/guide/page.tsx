import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { GuideView, type GuideViewSection } from "@/components/GuideView";
import { getAppContext } from "@/lib/context";
import { GUIDE } from "@/lib/guide";
import { ROLE_LABELS, type Role } from "@/lib/roles";

export const metadata = { title: "App guide" };

export default async function GuidePage() {
  await primeLang();
  const { role, features, company } = await getAppContext();
  const who = (r: Role[] | "all" | "managers") =>
    r === "all" ? tr("Everyone") : r === "managers" ? tr(ROLE_LABELS.management) : r.map((x) => tr(ROLE_LABELS[x])).join(", ");
  const mine = (r: Role[] | "all" | "managers") => r === "all" || (r === "managers" ? role === "management" : r.includes(role));
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
      <p className="small no-print">
        <Link href="/help">{tr("← Help")}</Link>
      </p>
      <GuideView sections={sections} company={company.name} roleLabel={tr(ROLE_LABELS[role])} />
    </>
  );
}
