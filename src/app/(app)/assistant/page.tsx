import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AssistantChat } from "@/components/assistant/AssistantChat";
import { aiConfigured, EXAMPLE_QUESTIONS } from "@/lib/assistant";
import { getAppContext } from "@/lib/context";
import { askAssistant } from "./actions";

export const metadata = { title: "Business assistant" };

export default async function AssistantPage() {
  await primeLang();
  const { role, features } = await getAppContext();
  if (role === "driver") redirect("/");
  if (!features.on("ai_assistant")) {
    return (
      <>
        <h1>{tr("Business assistant")}</h1>
        <p className="card muted">
          {tr("The assistant is switched off for this company.")}{" "}
          {role === "management" ? <Link href="/settings/features">{tr("Switch it on in Features & business level.")}</Link> : tr("Ask management to switch it on.")}
        </p>
      </>
    );
  }
  return (
    <>
      <h1>{tr("Business assistant")}</h1>
      <p className="muted small">
        {tr("Ask about your business in plain words, in English or Kiswahili. Answers come from your company's own records, only what your role may see, with links to the records behind them.")}
        {aiConfigured() ? ` ${tr("A secure AI service words the answers; only the figures in the answer are sent to it.")}` : ""}
      </p>
      <AssistantChat ask={askAssistant} examples={[...EXAMPLE_QUESTIONS]} />
    </>
  );
}
