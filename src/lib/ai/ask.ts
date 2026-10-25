import { aiReady, callClaude } from "@/lib/ai/claude";
import { askSystem, askUser, cleanAnswer, type PromptSource } from "@/lib/ai/ask-prompt";
import { isLegalQuestion, LEGAL_NOTE, searchKnowledge, type KnowledgeItem } from "@/lib/ai/knowledge";
import { findGuide, findPages, findRecords, guideHref, type Hit, type HitGroup, type SearchCtx } from "@/lib/ai/search";
import { builtInAnswer, detectTopic, type Answer } from "@/lib/assistant";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";
import { tr } from "@/lib/tr";

/**
 * "Ask": one question about the business, answered from
 *   - the assistant's figures (money owed, sales, stock…; src/lib/assistant.ts),
 *   - the App guide for "how do I…" questions,
 *   - the compliance list (requirements and documents) and the company's own checklist, licences
 *     and directors when those tables exist,
 *   - matching screens and records.
 * Everything is read with the signed-in person's access and role. With the AI service set up (and the
 * AI business assistant feature on) the sources found are given to it to word one answer with
 * numbered citations; only those sources leave the server. Without it, the answer is built here.
 */

export type AskSource = { n: number; kind: "figures" | "guide" | "rule" | "status" | "screen" | "record"; title: string; href?: string; external?: string };
export type StatusRow = { label: string; value: string; href?: string; tone?: "ok" | "warn" | "bad" };
export type AskAnswer = {
  question: string;
  title: string;
  text: string;
  ai: boolean;
  /** A documentation, legal or tax question: show the "guidance, not legal advice" note. */
  legal: boolean;
  legalNote?: string;
  sources: AskSource[];
  figures?: Answer;
  guide: { title: string; href: string; summary: string; steps: string[]; where: string }[];
  rules: { title: string; href: string; external?: string; authority: string | null; when: string | null; documents: string[]; summary: string; verify: string | null }[];
  status: StatusRow[];
  pages: Hit[];
  records: HitGroup[];
  notice?: string;
};

// ---------------------------------------------------------------------------------------------
// The company's own compliance status (the compliance module's tables; skipped if not set up yet)
// ---------------------------------------------------------------------------------------------

function tone(date: string | null, today: string, soonDays = 30): StatusRow["tone"] {
  if (!date) return undefined;
  if (date < today) return "bad";
  const soon = new Date(Date.parse(`${today}T00:00:00Z`) + soonDays * 864e5).toISOString().slice(0, 10);
  return date <= soon ? "warn" : "ok";
}

const ITEM_STATUS: Record<string, string> = { not_started: "Not started", in_progress: "In progress", done: "Done", not_applicable: "Not applicable" };
const LICENCE_STATUS: Record<string, string> = { planned: "Planned", applied: "Applied", active: "Active", expired: "Expired", suspended: "Suspended" };

/**
 * The checklist, licences, coming filings and (for management and finance) whether directors are
 * recorded. Read with the person's access: the database shows these to everyone except drivers,
 * and directors only to management and finance. Directors' names and IDs are never sent anywhere:
 * only how many are recorded and how many lack an ID number or TIN.
 */
async function companyStatus(ctx: SearchCtx, today: string): Promise<StatusRow[]> {
  if (!can(ctx.role, "seeDocuments") || !ctx.features.on("compliance")) return [];
  const q = async <T,>(p: PromiseLike<{ data: unknown; error: unknown }>): Promise<T[] | null> => {
    try {
      const { data, error } = await p;
      return error ? null : ((data ?? []) as T[]);
    } catch {
      return null;
    }
  };
  const until = new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 864e5).toISOString().slice(0, 10);
  type Item = { id: string; name: string; status: string; due_on: string | null; frequency: string };
  type Lic = { id: string; name: string; status: string; expires_on: string | null };
  type Dl = { item_id: string; due_on: string; status: string };
  type Dir = { id_number: string | null; tin: string | null; resigned_on: string | null };
  const [items, licences, deadlines, directors] = await Promise.all([
    q<Item>(ctx.supabase.from("compliance_items").select("id, name, status, due_on, frequency").eq("company_id", ctx.company.id).neq("status", "not_applicable").limit(300)),
    q<Lic>(ctx.supabase.from("licences").select("id, name, status, expires_on").eq("company_id", ctx.company.id).limit(200)),
    q<Dl>(ctx.supabase.from("compliance_deadlines").select("item_id, due_on, status").eq("company_id", ctx.company.id).eq("status", "open").lte("due_on", until).order("due_on").limit(40)),
    can(ctx.role, "seeFinance") ? q<Dir>(ctx.supabase.from("company_directors").select("id_number, tin, resigned_on").eq("company_id", ctx.company.id).limit(100)) : Promise.resolve(null),
  ]);
  const rows: StatusRow[] = [];
  const names = new Map((items ?? []).map((i) => [i.id, i.name]));
  for (const d of deadlines ?? []) {
    const name = names.get(d.item_id);
    if (name) rows.push({ label: `${tr(name)} · ${tr("filing")}`, value: `${tr("due")} ${d.due_on}`, href: "/compliance/calendar", tone: tone(d.due_on, today, 14) });
  }
  for (const i of items ?? []) {
    if (i.status === "done" && i.frequency !== "none") continue; // recurring: the filings above say more
    const t = i.status === "done" ? "ok" : (tone(i.due_on, today) ?? "warn");
    rows.push({ label: tr(i.name), value: [tr(ITEM_STATUS[i.status] ?? i.status), i.due_on].filter(Boolean).join(" · "), href: "/compliance", tone: t });
  }
  for (const l of licences ?? []) {
    const t = l.status === "expired" || l.status === "suspended" ? "bad" : l.status === "active" ? (tone(l.expires_on, today, 60) ?? "ok") : "warn";
    rows.push({ label: tr(l.name), value: [tr(LICENCE_STATUS[l.status] ?? l.status), l.expires_on ? `${tr("expires")} ${l.expires_on}` : null].filter(Boolean).join(" · "), href: "/compliance", tone: t });
  }
  if (directors) {
    const current = directors.filter((d) => !d.resigned_on);
    const missing = current.filter((d) => !d.id_number || !d.tin).length;
    rows.push({
      label: tr("Directors and shareholders recorded"),
      value: missing ? `${current.length} · ${missing} ${tr("without ID number or TIN")}` : String(current.length),
      href: "/compliance/directors",
      tone: current.length === 0 || missing ? "warn" : "ok",
    });
  }
  const order = { bad: 0, warn: 1, ok: 2 } as const;
  return rows.sort((a, b) => order[a.tone ?? "ok"] - order[b.tone ?? "ok"]).slice(0, 30);
}

// ---------------------------------------------------------------------------------------------
// The answer
// ---------------------------------------------------------------------------------------------

const ruleView = (k: KnowledgeItem, complianceOn: boolean) => ({
  title: k.title,
  href: complianceOn ? k.href : "/documents",
  external: k.external ?? undefined,
  authority: k.authority,
  when: k.when,
  documents: k.documents,
  summary: k.summary,
  verify: k.verify,
});

export async function askBusiness(
  ctx: SearchCtx,
  rawQuestion: string,
  lang: "en" | "sw",
  opts: { allowAi?: boolean; allowFigures?: boolean } = {},
): Promise<AskAnswer> {
  const question = rawQuestion.replace(/\s+/g, " ").trim().slice(0, 500);
  const today = todayTz();
  const legal = isLegalQuestion(question);
  const topic = detectTopic(question);
  const figuresWanted = opts.allowFigures !== false && ctx.role !== "driver" && ctx.features.on("ai_assistant") && topic !== "help";

  // Legal questions first look at the compliance list; "how do I" questions at the guide.
  const rulesFound = searchKnowledge(question, legal ? 5 : 2);
  const complianceOn = ctx.features.on("compliance");
  const [figures, status, records] = await Promise.all([
    figuresWanted ? builtInAnswer({ supabase: ctx.supabase, company: ctx.company, role: ctx.role }, question, topic) : Promise.resolve(undefined),
    legal || rulesFound.length ? companyStatus(ctx, today) : Promise.resolve([] as StatusRow[]),
    question.length <= 60 ? findRecords(ctx, question, 4) : Promise.resolve([] as HitGroup[]),
  ]);
  const guideFound = findGuide(ctx, question, legal ? 2 : 3);
  const pages = findPages(ctx, question, 5);
  const usefulFigures = figures && figures.topic !== "help" ? figures : undefined;

  // Numbered sources (the same numbers the AI cites).
  const sources: AskSource[] = [];
  const prompt: PromptSource[] = [];
  const add = (s: Omit<AskSource, "n">, body: string) => {
    const n = sources.length + 1;
    sources.push({ ...s, n });
    prompt.push({ n, kind: s.kind, title: s.title, body });
  };
  if (usefulFigures) {
    add(
      { kind: "figures", title: usefulFigures.title, href: usefulFigures.links?.[0]?.href },
      [usefulFigures.text, ...(usefulFigures.rows ?? []).slice(0, 12).map((r) => `- ${r.label}: ${r.value}`)].join("\n"),
    );
  }
  for (const k of rulesFound) {
    add(
      { kind: "rule", title: k.item.title, href: complianceOn ? k.item.href : undefined, external: k.item.external ?? undefined },
      [
        k.item.summary,
        k.item.authority && `Authority: ${k.item.authority}`,
        k.item.when && `When: ${k.item.when}`,
        k.item.documents.length ? `Documents: ${k.item.documents.join("; ")}` : "",
        k.item.penalty && `If missed: ${k.item.penalty}`,
        k.item.verify && `To confirm with the authority: ${k.item.verify}`,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  if (status.length) {
    add({ kind: "status", title: tr("Your company's checklist"), href: "/compliance" }, status.map((s) => `- ${s.label}: ${s.value}${s.tone === "bad" ? " (late or missing)" : s.tone === "warn" ? " (due soon)" : ""}`).join("\n"));
  }
  for (const g of guideFound) {
    add(
      { kind: "guide", title: g.topic.title, href: g.topic.href ?? guideHref(g.topic) },
      [g.topic.summary, `Where: ${g.topic.laptop.join(" → ")} (phone: ${g.topic.phone.join(" → ")})`, ...g.topic.steps.slice(0, 8).map((s, i) => `${i + 1}. ${s}`)].join("\n"),
    );
  }
  for (const p of pages.slice(0, 3)) add({ kind: "screen", title: p.title, href: p.href }, `${p.title}: ${p.sub}`);
  for (const g of records) for (const h of g.hits.slice(0, 2)) add({ kind: "record", title: `${tr(g.title)}: ${h.title}`, href: h.href }, `${g.title}: ${h.title} ${h.sub} ${h.side ?? ""}`);

  const base: AskAnswer = {
    question,
    title: usefulFigures?.title ?? (legal && rulesFound.length ? tr("Documents and rules that apply") : guideFound.length ? tr("From the App guide") : tr("What I found")),
    text: "",
    ai: false,
    legal: legal || rulesFound.length > 0,
    legalNote: legal || rulesFound.length > 0 ? tr(LEGAL_NOTE) : undefined,
    sources,
    figures: usefulFigures,
    guide: guideFound.map((g) => ({
      title: tr(g.topic.title),
      href: g.topic.href ?? guideHref(g.topic),
      summary: tr(g.topic.summary),
      steps: g.topic.steps.map(tr),
      where: g.topic.laptop.map(tr).join(" → "),
    })),
    rules: rulesFound.map((k) => ruleView(k.item, complianceOn)),
    status,
    pages,
    records,
  };

  // The built-in answer.
  base.text = usefulFigures
    ? usefulFigures.text
    : rulesFound.length
      ? tr("These requirements match your question. Each lists the documents to keep ready; open one to see more.")
      : guideFound.length
        ? `${tr(guideFound[0].topic.title)}: ${tr(guideFound[0].topic.summary)}`
        : pages.length || records.length
          ? tr("These screens and records match your question.")
          : tr("I could not find an answer to that. Try other words, ask about money owed, sales or stock, or open the App guide.");

  // Worded by the AI service, when allowed.
  if (opts.allowAi !== false && aiReady() && ctx.features.on("ai_assistant") && ctx.role !== "driver" && question && prompt.length) {
    const { data: allowed, error } = await ctx.supabase.rpc("use_assistant", { p_company: ctx.company.id });
    if (error || allowed !== true) {
      base.notice = tr("Today's AI questions are used up; this answer is from the built-in search.");
      return base;
    }
    const res = await callClaude({
      system: askSystem({ company: ctx.company.name, lang, today, legal: base.legal }),
      content: [{ type: "text", text: askUser(question, prompt) }],
      maxTokens: 3000,
      timeoutMs: 20000,
    });
    if (res.ok) {
      const text = cleanAnswer(res.text, sources.length);
      if (text) return { ...base, text, ai: true };
    }
  }
  return base;
}
