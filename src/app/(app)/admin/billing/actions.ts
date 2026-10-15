"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { onAdminHost } from "@/lib/hosts-server";
import { optional, str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";
import { isMissingSql } from "@/components/suggestions/meta";
import { BILLING_MISSING } from "@/lib/billing";
import { platformAdmin } from "../guard";

type DbError = { code?: string | null; message?: string | null } | null;
const explain = (e: DbError) => (isMissingSql(e) ? BILLING_MISSING : friendlyError(e?.message));
const uuid = (v: string) => (/^[0-9a-f-]{36}$/i.test(v) ? v : null);
const KEY_RE = /^[a-z][a-z0-9_-]{1,59}$/;
const safeBack = (v: string, fallback: string) => (v.startsWith("/admin") ? v : fallback);
const num = (v: string) => (v.trim() === "" ? null : Number(v.replace(/,/g, "")));

async function requireAdmin() {
  const { supabase, ok } = await platformAdmin();
  if (!ok) redirect(withNotice((await onAdminHost()) ? "/admin" : "/", { error: "That area is only for the LeMo Tech platform team." }));
  return supabase;
}

function done(back: string, msg: string): never {
  revalidatePath("/admin/billing", "layout");
  redirect(withNotice(back, { msg }));
}

/* ---------------- Requests ---------------- */

export async function decideRequest(form: FormData) {
  const supabase = await requireAdmin();
  const back = safeBack(str(form, "back"), "/admin/billing/requests");
  const id = uuid(str(form, "id"));
  const action = str(form, "action");
  if (!id || !["approve", "decline", "deliver", "end"].includes(action)) redirect(back);
  const price = num(str(form, "quoted_price"));
  const { error } = await supabase.rpc("admin_decide_request", {
    p_id: id,
    p_action: action,
    p_note: optional(form, "note"),
    p_quoted_price: price !== null && Number.isFinite(price) ? price : null,
  });
  if (error) redirect(withNotice(back, { error: explain(error) }));
  done(
    back,
    action === "approve"
      ? "Approved. The company has been told."
      : action === "decline"
        ? "Declined. The company has been told."
        : action === "deliver"
          ? "Marked as done."
          : "Ended. Add-on features are back to the level default.",
  );
}

export async function grantItem(form: FormData) {
  const supabase = await requireAdmin();
  const company = uuid(str(form, "company_id"));
  if (!company) redirect("/admin/billing");
  const back = safeBack(str(form, "back"), `/admin/billing/${company}`);
  const key = str(form, "item");
  if (!KEY_RE.test(key)) redirect(withNotice(back, { error: "Choose an item." }));
  const qty = num(str(form, "quantity")) ?? 1;
  const { error } = await supabase.rpc("admin_grant_item", { p_company: company, p_item: key, p_quantity: qty, p_note: optional(form, "note") });
  if (error) redirect(withNotice(back, { error: explain(error) }));
  done(back, "Given to the company. They have been told.");
}

/* ---------------- Company terms and invoices ---------------- */

export async function saveCompanyBilling(form: FormData) {
  const supabase = await requireAdmin();
  const company = uuid(str(form, "company_id"));
  if (!company) redirect("/admin/billing");
  const back = `/admin/billing/${company}`;
  const { error } = await supabase.rpc("admin_set_company_billing", {
    p_company: company,
    p_currency: str(form, "currency") === "USD" ? "USD" : "TZS",
    p_cycle: ["monthly", "quarterly", "annual"].includes(str(form, "cycle")) ? str(form, "cycle") : "monthly",
    p_discount: num(str(form, "discount_pct")) ?? 0,
    p_founding: str(form, "founding") === "on",
    p_status: str(form, "status") || "trial",
    p_trial_ends: optional(form, "trial_ends_on"),
    p_next_invoice: optional(form, "next_invoice_on"),
  });
  if (error) redirect(withNotice(`${back}#terms`, { error: explain(error) }));
  done(`${back}#terms`, "Billing terms saved.");
}

/** New invoice from the form's lines (line_key[], line_desc[], line_qty[], line_price[], line_use[]). */
export async function createInvoice(form: FormData) {
  const supabase = await requireAdmin();
  const company = uuid(str(form, "company_id"));
  if (!company) redirect("/admin/billing");
  const back = `/admin/billing/${company}`;
  const keys = form.getAll("line_key").map(String);
  const descs = form.getAll("line_desc").map(String);
  const qtys = form.getAll("line_qty").map(String);
  const prices = form.getAll("line_price").map(String);
  const use = new Set(form.getAll("line_use").map(String));
  const reqs = form.getAll("line_req").map(String);
  const lines: { item_key: string | null; description: string; quantity: number; unit_price: number }[] = [];
  const requestIds: string[] = [];
  descs.forEach((d, n) => {
    if (!use.has(String(n))) return;
    const q = num(qtys[n] ?? "");
    const p = num(prices[n] ?? "");
    if (!d.trim() || q === null || p === null || !Number.isFinite(q) || !Number.isFinite(p)) return;
    lines.push({ item_key: KEY_RE.test(keys[n] ?? "") ? keys[n] : null, description: d.trim(), quantity: q, unit_price: p });
    if (uuid(reqs[n] ?? "")) requestIds.push(reqs[n]);
  });
  if (lines.length === 0) redirect(withNotice(`${back}#new`, { error: "Tick at least one line with a description, quantity and price." }));
  const { error } = await supabase.rpc("admin_create_invoice", {
    p_company: company,
    p_currency: str(form, "currency") === "USD" ? "USD" : "TZS",
    p_lines: lines,
    p_period_start: optional(form, "period_start"),
    p_period_end: optional(form, "period_end"),
    p_notes: optional(form, "notes"),
    p_request_ids: requestIds,
    p_issue: str(form, "issue") === "1",
    p_discount_pct: num(str(form, "discount_pct")),
  });
  if (error) redirect(withNotice(`${back}#new`, { error: explain(error) }));
  done(`${back}#invoices`, str(form, "issue") === "1" ? "Invoice issued. Management and finance have been told." : "Draft saved.");
}

export async function issueInvoice(form: FormData) {
  const supabase = await requireAdmin();
  const id = uuid(str(form, "id"));
  const back = safeBack(str(form, "back"), "/admin/billing");
  if (!id) redirect(back);
  const { error } = await supabase.rpc("admin_issue_invoice", { p_id: id });
  if (error) redirect(withNotice(back, { error: explain(error) }));
  done(back, "Invoice issued. Management and finance have been told.");
}

export async function recordPayment(form: FormData) {
  const supabase = await requireAdmin();
  const id = uuid(str(form, "id"));
  const back = safeBack(str(form, "back"), "/admin/billing");
  if (!id) redirect(back);
  const { error } = await supabase.rpc("admin_record_invoice_payment", {
    p_id: id,
    p_amount: num(str(form, "amount")),
    p_method: optional(form, "method"),
    p_ref: optional(form, "ref"),
    p_paid_on: optional(form, "paid_on"),
  });
  if (error) redirect(withNotice(back, { error: explain(error) }));
  done(back, "Payment recorded.");
}

export async function voidInvoice(form: FormData) {
  const supabase = await requireAdmin();
  const id = uuid(str(form, "id"));
  const back = safeBack(str(form, "back"), "/admin/billing");
  if (!id) redirect(back);
  const { error } = await supabase.rpc("admin_void_invoice", { p_id: id, p_reason: str(form, "reason") });
  if (error) redirect(withNotice(back, { error: explain(error) }));
  done(back, "Invoice cancelled.");
}

/* ---------------- Price book and settings ---------------- */

export async function savePriceItem(form: FormData) {
  const supabase = await requireAdmin();
  const back = "/admin/billing/prices";
  const key = str(form, "key").toLowerCase();
  const features = str(form, "feature_keys")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const { error } = await supabase.rpc("admin_save_price_item", {
    p: {
      key,
      category: str(form, "category"),
      name: str(form, "name"),
      description: str(form, "description"),
      unit: str(form, "unit"),
      price_tzs: str(form, "price_tzs").replace(/,/g, ""),
      price_usd: str(form, "price_usd").replace(/,/g, ""),
      level: str(form, "level"),
      included_users: str(form, "included_users"),
      feature_keys: features,
      playbook_id: str(form, "playbook_id"),
      requestable: str(form, "requestable") === "on",
      public: str(form, "public") === "on",
      active: str(form, "active") === "on",
      sort: str(form, "sort"),
    },
  });
  if (error) redirect(withNotice(`${back}#${key}`, { error: explain(error) }));
  done(`${back}#${key}`, "Price book saved.");
}

export async function saveBillingSettings(form: FormData) {
  const supabase = await requireAdmin();
  const back = "/admin/billing/settings";
  const fields = ["legal_name", "tin", "vrn", "address", "phone", "email", "bank_details", "mobile_money", "vat_rate", "usd_rate", "payment_days", "invoice_note"];
  const p = Object.fromEntries(fields.map((f) => [f, str(form, f)]));
  const { error } = await supabase.rpc("admin_save_billing_settings", { p });
  if (error) redirect(withNotice(back, { error: explain(error) }));
  done(back, "Settings saved.");
}
