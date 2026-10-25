"use server";

import { askBusiness, type AskAnswer } from "@/lib/ai/ask";
import { findGuide, findPages, findRecords, guideHref, type Hit, type HitGroup } from "@/lib/ai/search";
import { getAppContext } from "@/lib/context";
import { primeLang, tr } from "@/lib/tr";

export type QuickResults = { q: string; pages: Hit[]; guide: Hit[]; records: HitGroup[] };

async function ctx() {
  const lang = await primeLang();
  const { supabase, company, role, isManager, isPlatformAdmin, features } = await getAppContext();
  return { lang, c: { supabase, company, role, isManager, isPlatformAdmin, features: { on: features.on, list: features.list } } };
}

/** Instant matches while typing: screens, guide topics and records (no AI). */
export async function quickSearch(raw: string): Promise<QuickResults> {
  const q = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (q.length < 2) return { q, pages: [], guide: [], records: [] };
  const { c } = await ctx();
  const records = await findRecords(c, q, 4);
  const guide = findGuide(c, q, 3).map((g) => ({ href: g.topic.href ?? guideHref(g.topic), title: tr(g.topic.title), sub: tr(g.topic.summary), side: tr("Guide") }));
  return { q, pages: findPages(c, q, 5), guide, records: records.map((g) => ({ ...g, title: tr(g.title) })) };
}

/** "Ask AI": the full answer with its sources. */
export async function askQuestion(raw: string): Promise<AskAnswer> {
  const { lang, c } = await ctx();
  return askBusiness(c, String(raw ?? ""), lang);
}
