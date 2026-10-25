"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { COMPLIANCE_CATALOGUE, COMPLIANCE_CATEGORIES, requirement } from "@/lib/compliance/catalogue";
import { legalRules, RULE_DEFS, TZ_LEGAL } from "@/lib/compliance/rules";

const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
const isId = (v: string | null | undefined) => !!v && /^[0-9a-f-]{36}$/.test(v);
const CATEGORIES = new Set<string>(COMPLIANCE_CATEGORIES.map((c) => c.key));

/** Only paths inside the compliance area are used to come back to. */
function backTo(form: FormData, fallback: string): string {
  const b = str(form, "back");
  return b.startsWith("/compliance") && !b.startsWith("//") ? b : fallback;
}

function fail(path: string, message: string): never {
  redirect(withNotice(path, { error: friendlyError(complianceError(message)) }));
}

function done(path: string, msg: string): never {
  revalidatePath("/compliance", "layout");
  revalidatePath("/");
  redirect(withNotice(path, { msg }));
}

function complianceError(message: string): string {
  if (/compliance_items_code_key/.test(message)) return "That requirement is already on your checklist.";
  if (/compliance_documents_(item|licence)_key/.test(message)) return "That document is already linked.";
  if (/licences_check|expires_on.*issued_on/.test(message)) return "The expiry date must be after the issue date.";
  if (/company_directors_check/.test(message)) return "The resignation date must be after the appointment date.";
  if (/check constraint.*name/.test(message)) return "Enter a name (2 to 160 letters).";
  if (/foreign key/.test(message)) return "That record was not found in your company.";
  return message;
}

// ------------------------------------------------------------------ checklist

export async function adoptRequirements(form: FormData) {
  const path = "/compliance/checklist/adopt";
  const codes = form.getAll("code").filter((c): c is string => typeof c === "string" && /^[A-Z][A-Z0-9_]+$/.test(c));
  if (codes.length === 0) fail(path, "Choose at least one requirement.");
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.rpc("compliance_adopt", {
    p_company: company.id,
    p_codes: codes,
    p_registered: str(form, "registered") === "1",
  });
  if (error) fail(path, error.message);
  const n = Number(data ?? 0);
  done("/compliance/checklist", n === 1 ? "1 requirement added to your checklist." : `${n} requirements added to your checklist.`);
}

export async function setItemStatus(form: FormData) {
  const id = str(form, "id");
  const path = backTo(form, `/compliance/checklist/${id}`);
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("compliance_set_status", { p_item: id, p_status: str(form, "status"), p_note: optional(form, "note") });
  if (error) fail(path, error.message);
  done(path, "Saved.");
}

function itemValues(form: FormData, path: string) {
  const name = str(form, "name");
  if (name.length < 2) fail(path, "Enter a name (2 to 160 letters).");
  const category = str(form, "category");
  const frequency = str(form, "frequency");
  const dueDay = toNumber(str(form, "due_day"));
  const offset = toNumber(str(form, "due_offset_months"));
  if (dueDay !== null && (Number.isNaN(dueDay) || dueDay < 1 || dueDay > 31)) fail(path, "The due day must be from 1 to 31.");
  if (offset !== null && (Number.isNaN(offset) || offset < -11 || offset > 12)) fail(path, "Months after the period must be from -11 to 12.");
  const values: Record<string, unknown> = {
    name,
    category: CATEGORIES.has(category) ? category : "company",
    authority: optional(form, "authority"),
    frequency: ["none", "monthly", "quarterly", "annual"].includes(frequency) ? frequency : "none",
    due_day: dueDay === null ? null : Math.round(dueDay),
    due_offset_months: offset === null ? null : Math.round(offset),
    due_on: isDate(optional(form, "due_on")) ? optional(form, "due_on") : null,
    owner_id: isId(optional(form, "owner_id")) ? optional(form, "owner_id") : null,
    licence_id: isId(optional(form, "licence_id")) ? optional(form, "licence_id") : null,
    notes: optional(form, "notes"),
  };
  if (form.has("calendar_from")) values.calendar_from = isDate(optional(form, "calendar_from")) ? optional(form, "calendar_from") : null;
  return values;
}

export async function createItem(form: FormData) {
  const path = "/compliance/checklist/new";
  const values = itemValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("compliance_items").insert({ company_id: company.id, ...values }).select("id").single();
  if (error) fail(path, error.message);
  done(`/compliance/checklist/${data.id}`, "Added to your checklist.");
}

export async function saveItem(form: FormData) {
  const id = str(form, "id");
  const path = `/compliance/checklist/${id}`;
  const values = itemValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("compliance_items").update(values).eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  done(path, "Saved.");
}

export async function deleteItem(form: FormData) {
  const id = str(form, "id");
  const path = `/compliance/checklist/${id}`;
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("compliance_items").delete().eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  done("/compliance/checklist", "Removed from your checklist.");
}

// ------------------------------------------------------------------ documents

/** Link a library document to a checklist item or a licence (used after an upload, and for existing documents). */
export async function linkComplianceDocument(target: { itemId?: string; licenceId?: string }, documentId: string): Promise<{ error?: string }> {
  if (!isId(documentId) || (!isId(target.itemId) && !isId(target.licenceId))) return { error: "That record was not found." };
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.from("compliance_documents").insert({
    company_id: company.id,
    document_id: documentId,
    item_id: target.itemId ?? null,
    licence_id: target.itemId ? null : (target.licenceId ?? null),
  });
  if (error) return { error: friendlyError(complianceError(error.message)) };
  revalidatePath("/compliance", "layout");
  return {};
}

export async function linkExistingDocument(form: FormData) {
  const itemId = optional(form, "item_id") ?? undefined;
  const licenceId = optional(form, "licence_id") ?? undefined;
  const path = backTo(form, itemId ? `/compliance/checklist/${itemId}` : `/compliance/licences/${licenceId}`);
  const res = await linkComplianceDocument({ itemId, licenceId }, str(form, "document_id"));
  if (res.error) fail(path, res.error);
  done(path, "Document linked.");
}

export async function unlinkDocument(form: FormData) {
  const path = backTo(form, "/compliance");
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("compliance_documents").delete().eq("id", str(form, "link_id")).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  done(path, "Document unlinked. It stays in the documents library.");
}

// ------------------------------------------------------------------ licences

function licenceValues(form: FormData, path: string) {
  const name = str(form, "name");
  if (name.length < 2) fail(path, "Enter the name of the licence.");
  const remind = toNumber(str(form, "remind_days"));
  const cost = toNumber(str(form, "cost"));
  if (cost !== null && (Number.isNaN(cost) || cost < 0)) fail(path, "The cost must be a number.");
  const currency = str(form, "currency").toUpperCase();
  return {
    name,
    authority: optional(form, "authority"),
    catalogue_code: optional(form, "catalogue_code"),
    licence_no: optional(form, "licence_no"),
    category: optional(form, "category"),
    product_scope: optional(form, "product_scope"),
    applied_on: isDate(optional(form, "applied_on")) ? optional(form, "applied_on") : null,
    issued_on: isDate(optional(form, "issued_on")) ? optional(form, "issued_on") : null,
    expires_on: isDate(optional(form, "expires_on")) ? optional(form, "expires_on") : null,
    remind_days: remind === null || Number.isNaN(remind) ? 60 : Math.min(Math.max(Math.round(remind), 0), 365),
    conditions: optional(form, "conditions"),
    cost: cost === null ? null : cost,
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "TZS",
    notes: optional(form, "notes"),
  };
}

export async function createLicence(form: FormData) {
  const path = "/compliance/licences/new";
  const values = licenceValues(form, path);
  const status = str(form, "status");
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase
    .from("licences")
    .insert({ company_id: company.id, ...values, status: ["planned", "applied", "active"].includes(status) ? status : "planned" })
    .select("id")
    .single();
  if (error) fail(path, error.message);
  const itemId = optional(form, "item_id");
  if (isId(itemId)) await supabase.from("compliance_items").update({ licence_id: data.id }).eq("id", itemId).eq("company_id", company.id);
  done(`/compliance/licences/${data.id}`, "Licence added. Upload the certificate below.");
}

export async function saveLicence(form: FormData) {
  const id = str(form, "id");
  const path = `/compliance/licences/${id}`;
  const values = licenceValues(form, path);
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("licences").update(values).eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  done(path, "Saved.");
}

export async function setLicenceStatus(form: FormData) {
  const id = str(form, "id");
  const path = `/compliance/licences/${id}`;
  const on = optional(form, "on");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("compliance_set_licence_status", { p_licence: id, p_status: str(form, "status"), p_on: isDate(on) ? on : null });
  if (error) fail(path, error.message);
  done(path, "Saved.");
}

export async function deleteLicence(form: FormData) {
  const id = str(form, "id");
  const path = `/compliance/licences/${id}`;
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("licences").delete().eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  done("/compliance/licences", "Licence removed. Its documents stay in the library.");
}

// ------------------------------------------------------------------ calendar

export async function markFiled(form: FormData) {
  const path = backTo(form, "/compliance/calendar");
  const on = optional(form, "filed_on");
  const paid = optional(form, "paid_on");
  const amount = toNumber(str(form, "amount"));
  if (amount !== null && (Number.isNaN(amount) || amount < 0)) fail(path, "The amount must be a number.");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("compliance_mark_filed", {
    p_deadline: str(form, "id"),
    p_filed_on: isDate(on) ? on : null,
    p_reference: optional(form, "reference"),
    p_note: optional(form, "note"),
    p_amount: amount,
    p_control_number: optional(form, "control_number"),
    p_paid_on: isDate(paid) ? paid : null,
  });
  if (error) fail(path, error.message);
  done(path, "Marked filed.");
}

export async function skipFiling(form: FormData) {
  const path = backTo(form, "/compliance/calendar");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("compliance_skip_filing", { p_deadline: str(form, "id"), p_note: optional(form, "note") });
  if (error) fail(path, error.message);
  done(path, "Marked: nothing to file for that period.");
}

export async function reopenFiling(form: FormData) {
  const path = backTo(form, "/compliance/calendar");
  const { supabase } = await getAppContext();
  const { error } = await supabase.rpc("compliance_reopen_filing", { p_deadline: str(form, "id") });
  if (error) fail(path, error.message);
  done(path, "Opened again.");
}

// ------------------------------------------------------------------ directors, shares, settings

export async function saveDirector(form: FormData) {
  const id = optional(form, "id");
  const path = "/compliance/directors";
  const name = str(form, "full_name");
  if (name.length < 2) fail(path, "Enter the full name.");
  const pct = toNumber(str(form, "share_percent"));
  if (pct !== null && (Number.isNaN(pct) || pct < 0 || pct > 100)) fail(path, "The share must be a percentage from 0 to 100.");
  const shares = toNumber(str(form, "shares_held"));
  const role = str(form, "role");
  const idType = str(form, "id_type");
  const values = {
    full_name: name,
    role: ["director", "managing_director", "chairperson", "secretary", "shareholder"].includes(role) ? role : "director",
    id_type: ["nida", "passport", "other"].includes(idType) ? idType : "nida",
    id_number: optional(form, "id_number"),
    nationality: optional(form, "nationality"),
    tin: optional(form, "tin"),
    appointed_on: isDate(optional(form, "appointed_on")) ? optional(form, "appointed_on") : null,
    resigned_on: isDate(optional(form, "resigned_on")) ? optional(form, "resigned_on") : null,
    phone: optional(form, "phone"),
    email: optional(form, "email"),
    address: optional(form, "address"),
    share_percent: pct === null ? null : Math.round(pct * 1000) / 1000,
    shares_held: shares === null || Number.isNaN(shares) ? null : Math.max(0, Math.round(shares)),
    notes: optional(form, "notes"),
    sort: Math.round(toNumber(str(form, "sort")) ?? 0) || 0,
  };
  const { supabase, company } = await getAppContext();
  if (id) {
    const { data, error } = await supabase.from("company_directors").update(values).eq("id", id).eq("company_id", company.id).select("id");
    if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  } else {
    const { error } = await supabase.from("company_directors").insert({ company_id: company.id, ...values });
    if (error) fail(path, error.message);
  }
  done(path, id ? "Saved." : "Added.");
}

export async function deleteDirector(form: FormData) {
  const path = "/compliance/directors";
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.from("company_directors").delete().eq("id", str(form, "id")).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  done(path, "Removed. If the person resigned, keep them with a resignation date instead.");
}

export async function setSharesDecided(form: FormData) {
  const path = "/compliance/directors";
  const decided = str(form, "decided") === "1";
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("compliance_set_shares_decided", { p_company: company.id, p_decided: decided });
  if (error) fail(path, error.message);
  done(path, decided ? "Shareholding marked as decided." : "Marked as not yet decided. The percentages are kept.");
}

export async function saveComplianceSettings(form: FormData) {
  const path = backTo(form, "/compliance/directors");
  const month = toNumber(str(form, "year_end_month"));
  const inc = optional(form, "incorporated_on");
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("compliance_save_settings", {
    p_company: company.id,
    p_year_end_month: month === null || Number.isNaN(month) ? 12 : Math.round(month),
    p_incorporated_on: isDate(inc) ? inc : null,
    p_shareholding_note: optional(form, "shareholding_note"),
    p_board_note: optional(form, "board_note"),
  });
  if (error) fail(path, error.message);
  done(path, "Saved.");
}

// ------------------------------------------------------------------ tax & legal rules

export async function saveRules(form: FormData) {
  const path = "/compliance/rules";
  const { supabase, company } = await getAppContext();
  const { data: row } = await supabase.from("compliance_settings").select("legal_rules").eq("company_id", company.id).maybeSingle();
  const current = legalRules(row?.legal_rules);
  const out: Record<string, unknown> = {};
  for (const def of RULE_DEFS) {
    const base = TZ_LEGAL[def.key];
    let v: unknown;
    if (typeof base === "boolean") v = form.has(`${def.key}__shown`) ? str(form, def.key) === "1" : current[def.key];
    else if (typeof base === "string") v = form.has(def.key) ? str(form, def.key).slice(0, 200) : current[def.key];
    else {
      if (!form.has(def.key)) v = current[def.key];
      else {
        const n = toNumber(str(form, def.key));
        if (n === null || Number.isNaN(n)) fail(path, `Enter a number for: ${def.label}`);
        if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max) || n < 0) fail(path, `The value is out of range for: ${def.label}`);
        v = def.unit === "day" || def.unit === "days" || def.unit === "months" || def.unit === "years" || def.unit === "hours" ? Math.round(n) : n;
      }
    }
    // Only what differs from the law as shipped is kept.
    if (v !== base) out[def.key] = v;
  }
  const { error } = await supabase.rpc("compliance_save_rules", { p_company: company.id, p_rules: out });
  if (error) fail(path, error.message);
  done(path, "Rules saved. The filing calendar follows the new due days.");
}

export async function resetRules(form: FormData) {
  const path = "/compliance/rules";
  const key = optional(form, "key");
  const { supabase, company } = await getAppContext();
  let rules: Record<string, unknown> = {};
  if (key) {
    const { data: row } = await supabase.from("compliance_settings").select("legal_rules").eq("company_id", company.id).maybeSingle();
    rules = { ...((row?.legal_rules as Record<string, unknown>) ?? {}) };
    delete rules[key];
  }
  const { error } = await supabase.rpc("compliance_save_rules", { p_company: company.id, p_rules: rules });
  if (error) fail(path, error.message);
  done(path, key ? "Back to the law for that rule." : "All rules are back to the law as shipped.");
}

// ------------------------------------------------------------------ audits and "not needed"

/** "Not needed for us": the requirement goes on the checklist as Does not apply (kept, and can be switched back). */
export async function markNotNeeded(form: FormData) {
  const code = str(form, "code");
  const path = backTo(form, "/compliance/audits");
  if (!requirement(code)) fail(path, "That requirement was not found.");
  const { supabase, company } = await getAppContext();
  const { error: adoptError } = await supabase.rpc("compliance_adopt", { p_company: company.id, p_codes: [code], p_registered: false });
  if (adoptError) fail(path, adoptError.message);
  const { data: item } = await supabase.from("compliance_items").select("id, status").eq("company_id", company.id).eq("code", code).maybeSingle();
  if (!item) fail(path, "That requirement was not found.");
  if (item.status !== "not_applicable") {
    const { error } = await supabase.rpc("compliance_set_status", {
      p_item: item.id,
      p_status: "not_applicable",
      p_note: optional(form, "note") ?? "Not needed for us.",
    });
    if (error) fail(path, error.message);
  }
  done(path, "Marked as not needed for us. Open it on the checklist to switch it back.");
}

/** Add the requirements of an audit pack to the checklist (those not there yet). */
export async function adoptPack(form: FormData) {
  const path = backTo(form, "/compliance/audits");
  const codes = form.getAll("code").filter((c): c is string => typeof c === "string" && !!requirement(c));
  if (!codes.length) fail(path, "Everything in this pack is already on your checklist.");
  const { supabase, company } = await getAppContext();
  const { data, error } = await supabase.rpc("compliance_adopt", { p_company: company.id, p_codes: codes, p_registered: false });
  if (error) fail(path, error.message);
  const n = Number(data ?? 0);
  done(path, n === 1 ? "1 requirement added to your checklist." : `${n} requirements added to your checklist.`);
}

/** Cocozania's "Add the usual licences": every licence on the checklist gets a line in the register to fill in. */
export async function addUsualLicences(form: FormData) {
  const path = backTo(form, "/compliance/licences");
  const { supabase, company } = await getAppContext();
  const [itemsRes, licRes, setRes] = await Promise.all([
    supabase.from("compliance_items").select("id, code, name, authority, status, licence_id").eq("company_id", company.id).not("code", "is", null).limit(1000),
    supabase.from("licences").select("catalogue_code").eq("company_id", company.id).not("catalogue_code", "is", null).limit(1000),
    supabase.from("compliance_settings").select("legal_rules").eq("company_id", company.id).maybeSingle(),
  ]);
  if (itemsRes.error) fail(path, itemsRes.error.message);
  const have = new Set(((licRes.data ?? []) as { catalogue_code: string }[]).map((l) => l.catalogue_code));
  const licenceCodes = new Set(COMPLIANCE_CATALOGUE.filter((r) => r.kind === "licence").map((r) => r.code));
  const remind = legalRules(setRes.data?.legal_rules).licence_remind_days;
  const todo = ((itemsRes.data ?? []) as { id: string; code: string; name: string; authority: string | null; status: string; licence_id: string | null }[]).filter(
    (i) => licenceCodes.has(i.code) && !i.licence_id && !have.has(i.code) && i.status !== "not_applicable",
  );
  if (!todo.length) fail(path, "Every licence on your checklist is already in the register. Add sector licences to the checklist first.");
  let n = 0;
  for (const i of todo) {
    const { data, error } = await supabase
      .from("licences")
      .insert({
        company_id: company.id,
        name: i.name.slice(0, 160),
        authority: i.authority,
        catalogue_code: i.code,
        status: i.status === "done" ? "active" : "planned",
        remind_days: remind,
      })
      .select("id")
      .single();
    if (error) fail(path, error.message);
    await supabase.from("compliance_items").update({ licence_id: data.id }).eq("id", i.id).eq("company_id", company.id);
    n++;
  }
  done(path, n === 1 ? "1 licence added to the register. Fill in its number and dates." : `${n} licences added to the register. Fill in their numbers and dates.`);
}
