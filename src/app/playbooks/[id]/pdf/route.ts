import { NextResponse } from "next/server";
import { getLang } from "@/lib/lang";
import { findPlaybook, scenarioCount, stepCount, translatePlaybook } from "@/lib/playbooks";
import { playbookPdf } from "@/lib/pdf/playbook";
import { SW } from "@/lib/sw";

/** A playbook as a PDF, in the reader's language. Public, like the playbook itself. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const raw = findPlaybook((await params).id);
  if (!raw) return new NextResponse("Not found", { status: 404 });
  const sw = (await getLang()) === "sw";
  const t = (s: string) => (sw ? (SW[s] ?? s) : s);
  const pb = translatePlaybook(raw, sw ? "sw" : "en", t);
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
    { steps: stepCount(raw), scenarios: scenarioCount(raw) },
  );
  const name = `LeMoSp playbook - ${raw.title}`.replace(/[^\w.\- ]+/g, "").trim() + ".pdf";
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
