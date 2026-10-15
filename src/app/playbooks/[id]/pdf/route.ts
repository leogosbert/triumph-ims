import { NextResponse } from "next/server";
import { getLang } from "@/lib/lang";
import { findPlaybook, scenarioCount, stepCount, translatePlaybook } from "@/lib/playbooks";
import { playbookPdf } from "@/lib/pdf/playbook";
import { SW } from "@/lib/sw";
import { playbookAccess } from "@/lib/playbooks/access";
import { nameTheCompany, tailorPlaybook } from "@/lib/playbooks/personalize";
import { playbookProfile } from "@/lib/playbooks/profile";

/** A playbook as a PDF, in the reader's language. Only for companies LeMo Tech has given it to. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const raw = findPlaybook((await params).id);
  if (!raw) return new NextResponse("Not found", { status: 404 });
  const access = await playbookAccess();
  if (access.state(raw.id) !== "granted") {
    return NextResponse.redirect(new URL(`/playbooks/${raw.id}`, req.url), 303);
  }
  const sw = (await getLang()) === "sw";
  const t = (s: string) => (sw ? (SW[s] ?? s) : s);
  // The company's own copy: its name, and only the steps that fit it (?full=1 for all of them).
  const profile = await playbookProfile(access.companyId);
  const fit = profile ? tailorPlaybook(raw, profile, { all: new URL(req.url).searchParams.get("full") === "1" }) : null;
  let pb = translatePlaybook(fit?.pb ?? raw, sw ? "sw" : "en", t);
  if (profile) pb = nameTheCompany(pb, profile.name);
  const bytes = await playbookPdf(
    pb,
    {
      playbook: t("Playbook"),
      contents: t("Contents"),
      chapter: t("Chapter"),
      stepByStep: t("Step by step"),
      where: t("Where:"),
      who: t("Who:"),
      example: t("Example"),
      ifThisHappens: t("If this happens"),
      whatToDo: t("What to do"),
      tip: t("Tip"),
      page: t("Page"),
      forWho: t("For:"),
      minutes: t("minutes to read"),
      chapters: t("chapters"),
      steps: t("steps"),
      scenarios: t("scenarios"),
      footer: t("LeMoSp · a LeMo Tech Solutions product"),
    },
    { steps: stepCount(pb), scenarios: scenarioCount(pb) },
    profile && fit
      ? {
          line: `${t("Made for")} ${profile.name}`,
          note: t("{kept} of {total} steps fit your company.").replace("{kept}", String(fit.kept)).replace("{total}", String(fit.total)),
        }
      : undefined,
  );
  const name = `LeMoSp playbook - ${raw.title}${profile?.name ? ` - ${profile.name}` : ""}`.replace(/[^\w.\- ]+/g, "").trim() + ".pdf";
  const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "private, max-age=300",
      Vary: "Cookie",
    },
  });
}
