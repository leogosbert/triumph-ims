"use server";

import { aiReady } from "@/lib/ai/claude";
import { askBusiness, type AskAnswer } from "@/lib/ai/ask";
import type { FinderEntry } from "@/lib/ai/finder";
import { findGuide, findPages, findRecords, guideHref, searchEntries, type Hit, type HitGroup } from "@/lib/ai/search";
import { can, onlyRoles } from "@/lib/roles";
import { todayTz } from "@/lib/sales";
import { detectTopic } from "@/lib/assistant";
import { getAppContext } from "@/lib/context";
import { primeLang, tr } from "@/lib/tr";

export type QuickResults = {
  q: string;
  pages: Hit[];
  guide: Hit[];
  records: HitGroup[];
  /** The words ask about the business's own figures (money owed, sales, stock…): answer at once. */
  figures: boolean;
  /** The AI service is set up and this person may use it. */
  aiOn: boolean;
  /** Ideas can be sent to the Suggestion Box. */
  canWish: boolean;
};

async function ctx() {
  const lang = await primeLang();
  const { supabase, company, roles, isManager, isPlatformAdmin, features } = await getAppContext();
  return { lang, c: { supabase, company, roles, isManager, isPlatformAdmin, features: { on: features.on, list: features.list } } };
}

/** Instant matches while typing: screens, guide topics and records (no AI). */
export async function quickSearch(raw: string): Promise<QuickResults> {
  const q = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
  const { c } = await ctx();
  const aiOn = aiReady() && c.features.on("ai_assistant") && !onlyRoles(c.roles, "driver");
  const canWish = c.features.on("suggestions");
  if (q.length < 2) return { q, pages: [], guide: [], records: [], figures: false, aiOn, canWish };
  const records = await findRecords(c, q, 4);
  const guide = findGuide(c, q, 3).map((g) => ({ href: g.topic.href ?? guideHref(g.topic), title: tr(g.topic.title), sub: tr(g.topic.summary), side: tr("Guide") }));
  const figures = !onlyRoles(c.roles, "driver") && c.features.on("ai_assistant") && detectTopic(q) !== "help";
  return { q, pages: findPages(c, q, 5), guide, records: records.map((g) => ({ ...g, title: tr(g.title) })), figures, aiOn, canWish };
}

/** The answer with its sources. `ai: false` gives the built-in answer only (instant, no AI allowance used). */
export async function askQuestion(raw: string, ai = true): Promise<AskAnswer> {
  const { lang, c } = await ctx();
  return askBusiness(c, String(raw ?? ""), lang, { allowAi: ai });
}

/** "Ask for this in the app": the search words go to the Suggestion Box as an idea about the app. */
export async function sendWish(raw: string): Promise<{ ok: boolean; error?: string }> {
  const q = String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (q.length < 3) return { ok: false, error: "Type what you were looking for first." };
  const { c } = await ctx();
  if (!c.features.on("suggestions")) return { ok: false, error: "The Suggestion Box is switched off." };
  const { error } = await c.supabase.rpc("submit_suggestion", {
    p_company: c.company.id,
    p_category: "technology",
    p_title: `App wish from search: ${q}`.slice(0, 140),
    p_body: `Searched for "${q}" and the app could not do it yet.`,
    p_about_app: true,
  });
  return error ? { ok: false, error: "Could not send. Please try again." } : { ok: true };
}

/** A short fingerprint of the index, so the browser downloads it again only when it changed. */
function fingerprint(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${s.length.toString(36)}.${(h >>> 0).toString(36)}`;
}

/**
 * The super search index for this person (screens, guide, compliance requirements, playbooks and what
 * the app does not do yet), in their language. The Ask box ranks it in the browser as you type and
 * keeps a copy, so it still finds screens and guides offline. `known`: the fingerprint the browser
 * already has; then only the fingerprint comes back.
 */
export async function searchIndex(known?: string): Promise<{ v: string; entries?: FinderEntry[] }> {
  const { lang, c } = await ctx();
  const entries = searchEntries(c, lang);
  const v = fingerprint(`${lang}|${[...c.roles].sort().join("+")}|${JSON.stringify(entries)}`);
  return known === v ? { v } : { v, entries };
}

export type RuleStatus = { label: string; tone: "ok" | "warn" | "bad"; href: string };

/** For a compliance requirement in the search: is it in place for this company right now? */
export async function ruleStatus(code: string): Promise<RuleStatus | null> {
  if (!/^[A-Za-z0-9_.-]{1,60}$/.test(code)) return null;
  const { c } = await ctx();
  if (!can(c.roles, "seeDocuments") || !c.features.on("compliance")) return null;
  const today = todayTz();
  try {
    const [lic, item] = await Promise.all([
      c.supabase.from("licences").select("status, expires_on").eq("company_id", c.company.id).eq("catalogue_code", code).order("expires_on", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
      c.supabase.from("compliance_items").select("status, due_on").eq("company_id", c.company.id).eq("code", code).limit(1).maybeSingle(),
    ]);
    const l = lic.error ? null : (lic.data as { status: string; expires_on: string | null } | null);
    const i = item.error ? null : (item.data as { status: string; due_on: string | null } | null);
    if (l) {
      if (l.status === "active" && (!l.expires_on || l.expires_on >= today)) {
        const soon = l.expires_on && l.expires_on <= new Date(Date.parse(`${today}T00:00:00Z`) + 60 * 864e5).toISOString().slice(0, 10);
        return { label: l.expires_on ? `${tr(soon ? "In place, renew soon" : "In place")} · ${tr("expires")} ${l.expires_on}` : tr("In place"), tone: soon ? "warn" : "ok", href: `/compliance#${code}` };
      }
      return { label: l.status === "expired" || (l.expires_on && l.expires_on < today) ? tr("Expired") : tr("Not in place yet"), tone: "bad", href: `/compliance#${code}` };
    }
    if (i) {
      if (i.status === "not_applicable") return { label: tr("Marked as not applying to you"), tone: "ok", href: `/compliance#${code}` };
      if (i.status === "done") return { label: tr("Done"), tone: "ok", href: `/compliance#${code}` };
      const late = i.due_on && i.due_on < today;
      return { label: `${tr(i.status === "in_progress" ? "In progress" : "Not started")}${i.due_on ? ` · ${tr("due")} ${i.due_on}` : ""}`, tone: late ? "bad" : "warn", href: `/compliance#${code}` };
    }
    return { label: tr("Not on your checklist yet"), tone: "warn", href: "/compliance" };
  } catch {
    return null;
  }
}
