"use server";

import { aiAnswer, aiConfigured, builtInAnswer, type Answer } from "@/lib/assistant";
import { getAppContext } from "@/lib/context";
import { primeLang, tr } from "@/lib/tr";

/** One question to the business assistant. */
export async function askAssistant(question: string): Promise<Answer> {
  const lang = await primeLang();
  const q = String(question ?? "").trim().slice(0, 500);
  const { supabase, company, role, features } = await getAppContext();
  if (!features.on("ai_assistant") || role === "driver") {
    return { topic: "help", title: tr("Assistant is switched off"), text: tr("Management can switch it on in Features & business level.") };
  }
  if (!q) return builtInAnswer({ supabase, company, role }, "", "help");
  const facts = await builtInAnswer({ supabase, company, role }, q);
  if (!aiConfigured() || facts.topic === "help") return facts;
  // The daily allowance for the outside AI service; without it the built-in answer is enough.
  const { data: allowed, error } = await supabase.rpc("use_assistant", { p_company: company.id });
  if (error || allowed !== true) return facts;
  const worded = await aiAnswer(q, facts, company, lang);
  return worded ? { ...facts, text: worded, ai: true } : facts;
}
