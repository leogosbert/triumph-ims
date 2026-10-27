"use server";

import { askBusiness } from "@/lib/ai/ask";
import { aiAnswer, aiConfigured, builtInAnswer, detectTopic, type Answer } from "@/lib/assistant";
import { getAppContext } from "@/lib/context";
import { onlyRoles } from "@/lib/roles";
import { primeLang, tr } from "@/lib/tr";

/** One question to the business assistant. */
export async function askAssistant(question: string): Promise<Answer> {
  const lang = await primeLang();
  const q = String(question ?? "").trim().slice(0, 500);
  const { supabase, company, roles, isManager, isPlatformAdmin, features } = await getAppContext();
  if (!features.on("ai_assistant") || onlyRoles(roles, "driver")) {
    return { topic: "help", title: tr("Assistant is switched off"), text: tr("Management can switch it on in Features & business level.") };
  }
  if (!q) return builtInAnswer({ supabase, company, roles }, "", "help");

  // Not about the figures ("how do I…", "what documents do I need…"): the App guide, the compliance
  // list and the records answer it, with their sources as the rows.
  if (detectTopic(q) === "help") {
    const a = await askBusiness({ supabase, company, roles, isManager, isPlatformAdmin, features: { on: features.on, list: features.list } }, q, lang, { allowFigures: false });
    if (a.sources.length === 0) return builtInAnswer({ supabase, company, roles }, q, "help");
    return {
      // Not "help": its rows would turn into buttons that ask the row as a question.
      topic: "summary",
      title: a.title,
      text: [a.text.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, ""), a.legalNote].filter(Boolean).join("\n\n"),
      ai: a.ai,
      rows: [
        ...a.steps.map((st, i) => ({ label: `${i + 1}. ${st.text.replace(/\s*\[\d+(?:,\s*\d+)*\]/g, "")}`, value: "", href: st.to })),
        ...a.status.slice(0, 8).map((r) => ({ label: r.label, value: r.value, href: r.href, tone: r.tone })),
        ...a.sources.filter((s) => s.kind !== "status").map((s) => ({ label: tr(s.title), value: "", href: s.href })),
      ],
      links: [
        ...(a.where ? [{ label: a.where.path.map(tr).join(" → "), href: a.where.to }] : []),
        { label: tr("Open in search"), href: `/search?q=${encodeURIComponent(q)}&ask=1` },
      ],
    };
  }

  const facts = await builtInAnswer({ supabase, company, roles }, q);
  if (!aiConfigured()) return facts;
  // The daily allowance for the outside AI service; without it the built-in answer is enough.
  const { data: allowed, error } = await supabase.rpc("use_assistant", { p_company: company.id });
  if (error || allowed !== true) return facts;
  const worded = await aiAnswer(q, facts, company, lang);
  return worded ? { ...facts, text: worded, ai: true } : facts;
}
