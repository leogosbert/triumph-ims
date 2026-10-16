"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { optional, str } from "@/lib/format";
import { ASSET_CATEGORIES, DISPOSAL_METHODS, PAID_FROM, isIsoDate, ledgerError } from "@/lib/ledger";
import { friendlyError, withNotice } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { tr } from "@/lib/tr";

function fail(path: string, error: string | null | undefined): never {
  redirect(withNotice(path, { error: friendlyError(ledgerError(error)) }));
}

/** Only a path inside Accounts is used to come back to. */
function backPath(form: FormData, fallback: string): string {
  const b = str(form, "back");
  return b.startsWith("/accounts") && !b.startsWith("//") ? b : fallback;
}

async function ledgerCtx(path: string) {
  const ctx = await getAppContext();
  if (!can(ctx.role, "seeLedger")) fail(path, "Only management or finance can see the books.");
  return ctx;
}

// ---- Health -------------------------------------------------------------------------------------
export async function resyncBooks(form: FormData) {
  const path = backPath(form, "/accounts");
  const { supabase, company } = await ledgerCtx(path);
  const { data, error } = await supabase.rpc("gl_resync", { p_company: company.id });
  if (error) fail(path, error.message);
  revalidatePath("/accounts", "layout");
  const n = Number(data ?? 0);
  redirect(
    withNotice(path, {
      msg: n === 0 ? tr("Everything was already in the books.") : `${tr("Posted again. Entries changed:")} ${n.toLocaleString("en-GB")}`,
    }),
  );
}

// ---- Journals -------------------------------------------------------------------------------------
type LineIn = { a: string; d: number; c: number; t: string };

/** Called by the journal form; returns an error to show, or the new journal's id. */
export async function createJournal(form: FormData): Promise<{ error?: string; id?: string }> {
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeLedger")) return { error: "Only management or finance can post journals." };
  const date = str(form, "entry_date");
  if (!isIsoDate(date)) return { error: "Choose the date of the journal." };
  const memo = str(form, "memo");
  if (memo.length < 2) return { error: "Say what the journal is for." };
  let raw: unknown;
  try {
    raw = JSON.parse(str(form, "lines") || "[]");
  } catch {
    return { error: "Something went wrong. Please try again." };
  }
  if (!Array.isArray(raw)) return { error: "Something went wrong. Please try again." };
  const lines: LineIn[] = [];
  for (const x of raw as Record<string, unknown>[]) {
    const d = Math.round(Number(x.d ?? 0) * 100) / 100;
    const c = Math.round(Number(x.c ?? 0) * 100) / 100;
    const a = typeof x.a === "string" ? x.a : "";
    const t = typeof x.t === "string" ? x.t.trim().slice(0, 300) : "";
    if (!a && !d && !c && !t) continue;
    if (!Number.isFinite(d) || !Number.isFinite(c) || d < 0 || c < 0 || (d > 0 && c > 0) || (d === 0 && c === 0)) {
      return { error: "Each line is either a debit or a credit, above zero." };
    }
    if (!a) return { error: "Choose an account on every line." };
    lines.push({ a, d, c, t });
  }
  if (lines.length < 2) return { error: "A journal needs between 2 and 200 lines." };
  const dr = lines.reduce((s, l) => s + l.d, 0);
  const cr = lines.reduce((s, l) => s + l.c, 0);
  if (Math.abs(dr - cr) >= 0.005) return { error: "The journal does not balance: the debits and credits must be equal." };
  const { data, error } = await supabase.rpc("gl_manual_journal", {
    p_company: company.id,
    p_date: date,
    p_memo: memo,
    p_lines: lines.map((l) => ({ a: l.a, d: l.d || undefined, c: l.c || undefined, t: l.t || undefined })),
    p_opening: str(form, "opening") === "yes",
  });
  if (error) return { error: friendlyError(ledgerError(error.message)) };
  revalidatePath("/accounts", "layout");
  return { id: String(data) };
}

export async function reverseJournal(form: FormData) {
  const id = str(form, "id");
  const path = `/accounts/journals/${id}`;
  const { supabase } = await ledgerCtx(path);
  const { data, error } = await supabase.rpc("gl_reverse_journal", { p_journal: id });
  if (error) fail(path, error.message);
  revalidatePath("/accounts", "layout");
  redirect(withNotice(`/accounts/journals/${data}`, { msg: "Journal reversed." }));
}

// ---- Closing ---------------------------------------------------------------------------------------
export async function closeBooks(form: FormData) {
  const path = "/accounts/close";
  const until = str(form, "until");
  if (!isIsoDate(until)) fail(path, "Choose the last day to close.");
  const { supabase, company } = await ledgerCtx(path);
  const { error } = await supabase.rpc("gl_close_books", { p_company: company.id, p_until: until });
  if (error) fail(path, error.message);
  revalidatePath("/", "layout");
  redirect(withNotice(path, { msg: "The books are closed." }));
}

export async function reopenBooks(form: FormData) {
  const path = "/accounts/close";
  if (str(form, "confirm") !== "yes") fail(path, "Tick the box to confirm.");
  const { supabase, company } = await ledgerCtx(path);
  const { error } = await supabase.rpc("gl_close_books", { p_company: company.id, p_until: null });
  if (error) fail(path, error.message);
  revalidatePath("/", "layout");
  redirect(withNotice(path, { msg: "The books are open again." }));
}

// ---- Chart of accounts ------------------------------------------------------------------------------
const TYPES = ["asset", "liability", "equity", "income", "expense"];

export async function addAccount(form: FormData) {
  const path = "/accounts/chart";
  const code = str(form, "code");
  const name = str(form, "name");
  const type = str(form, "type");
  if (!/^[0-9]{3,6}$/.test(code)) fail(path, "The account code must be 3 to 6 digits.");
  if (name.length < 2 || name.length > 120) fail(path, "The account name must be 2 to 120 characters.");
  if (!TYPES.includes(type)) fail(path, "Choose the type of account.");
  const { supabase, company } = await ledgerCtx(path);
  const { data, error } = await supabase
    .from("gl_accounts")
    .insert({ company_id: company.id, code, name, type, notes: optional(form, "notes") })
    .select("id")
    .single();
  if (error) fail(path, error.message);
  revalidatePath(path);
  redirect(withNotice(`/accounts/ledger/${data.id}`, { msg: "Account added." }));
}

export async function saveAccount(form: FormData) {
  const id = str(form, "id");
  const path = `/accounts/ledger/${id}`;
  const code = str(form, "code");
  const name = str(form, "name");
  if (!/^[0-9]{3,6}$/.test(code)) fail(path, "The account code must be 3 to 6 digits.");
  if (name.length < 2 || name.length > 120) fail(path, "The account name must be 2 to 120 characters.");
  const { supabase, company } = await ledgerCtx(path);
  const { data, error } = await supabase
    .from("gl_accounts")
    .update({ code, name, notes: optional(form, "notes") })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/accounts", "layout");
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function setAccountActive(form: FormData) {
  const id = str(form, "id");
  const path = `/accounts/ledger/${id}`;
  const active = str(form, "active") === "true";
  const { supabase, company } = await ledgerCtx(path);
  const { data, error } = await supabase.from("gl_accounts").update({ active }).eq("id", id).eq("company_id", company.id).select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/accounts", "layout");
  redirect(withNotice(path, { msg: active ? "Account switched on." : "Account switched off." }));
}

// ---- Fixed assets -------------------------------------------------------------------------------------
function money(form: FormData, key: string, path: string, label: string): number | null {
  const v = toNumber(str(form, key));
  if (v !== null && (Number.isNaN(v) || v < 0)) fail(path, label);
  return v;
}

export async function addAsset(form: FormData) {
  const path = "/accounts/assets/new";
  const name = str(form, "name");
  const category = str(form, "category");
  const boughtOn = str(form, "bought_on");
  const paidFrom = str(form, "paid_from");
  if (name.length < 2 || name.length > 120) fail(path, "The name must be 2 to 120 characters.");
  if (!ASSET_CATEGORIES.some((c) => c.key === category)) fail(path, "Choose the type of asset.");
  if (!isIsoDate(boughtOn)) fail(path, "Enter the date it was bought.");
  if (!PAID_FROM.some((p) => p.key === paidFrom)) fail(path, "Say how it was paid for.");
  const cost = money(form, "cost", path, "The cost must be above zero.");
  if (!cost || cost <= 0) fail(path, "The cost must be above zero.");
  const residual = money(form, "residual", path, "The value at the end cannot be negative.") ?? 0;
  if (residual >= cost) fail(path, "The value at the end must be less than the cost.");
  const life = toNumber(str(form, "life"));
  if (life === null || Number.isNaN(life) || life <= 0) fail(path, "Enter how long it will be used.");
  const months = str(form, "life_unit") === "months" ? Math.round(life) : Math.round(life * 12);
  if (months < 1 || months > 1200) fail(path, "The useful life must be between 1 and 1,200 months.");
  const { supabase, company } = await ledgerCtx(path);
  const { data, error } = await supabase.rpc("add_fixed_asset", {
    p_company: company.id,
    p_name: name,
    p_category: category,
    p_bought_on: boughtOn,
    p_cost: cost,
    p_residual: residual,
    p_life_months: months,
    p_paid_from: paidFrom,
    p_serial: optional(form, "serial_no"),
    p_location: optional(form, "location"),
    p_vehicle: optional(form, "vehicle_id"),
    p_notes: optional(form, "notes"),
  });
  if (error) fail(path, error.message);
  revalidatePath("/accounts", "layout");
  redirect(withNotice(`/accounts/assets/${data}`, { msg: "Asset added and posted to the books." }));
}

export async function saveAsset(form: FormData) {
  const id = str(form, "id");
  const path = `/accounts/assets/${id}`;
  const name = str(form, "name");
  const category = str(form, "category");
  if (name.length < 2 || name.length > 120) fail(path, "The name must be 2 to 120 characters.");
  if (!ASSET_CATEGORIES.some((c) => c.key === category)) fail(path, "Choose the type of asset.");
  const { supabase, company } = await ledgerCtx(path);
  const { data, error } = await supabase
    .from("fixed_assets")
    .update({
      name,
      category,
      serial_no: optional(form, "serial_no"),
      location: optional(form, "location"),
      vehicle_id: optional(form, "vehicle_id"),
      notes: optional(form, "notes"),
    })
    .eq("id", id)
    .eq("company_id", company.id)
    .select("id");
  if (error || !data?.length) fail(path, error?.message ?? "0 rows");
  revalidatePath("/accounts/assets");
  revalidatePath(path);
  redirect(withNotice(path, { msg: "Saved." }));
}

export async function postDepreciation(form: FormData) {
  const path = "/accounts/assets";
  const month = str(form, "month");
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(path, "Choose the month.");
  const { supabase, company } = await ledgerCtx(path);
  const { data, error } = await supabase.rpc("post_depreciation", { p_company: company.id, p_month: `${month}-01` });
  if (error) fail(path, error.message);
  revalidatePath("/accounts", "layout");
  const res = (data ?? {}) as { assets?: number; amount?: number };
  const count = Number(res.assets ?? 0);
  redirect(
    withNotice(path, {
      msg:
        count === 0
          ? tr("Nothing to post: every asset is already depreciated for that month.")
          : `${tr("Depreciation posted.")} ${tr("Assets:")} ${count} · ${formatMoney(Number(res.amount ?? 0), company.base_currency)}`,
    }),
  );
}

export async function disposeAsset(form: FormData) {
  const id = str(form, "id");
  const path = `/accounts/assets/${id}`;
  const on = str(form, "disposed_on");
  const method = str(form, "method") || "bank";
  if (!isIsoDate(on)) fail(path, "Enter the date it was sold or scrapped.");
  if (!DISPOSAL_METHODS.some((m) => m.key === method)) fail(path, "Say how the money was received.");
  if (str(form, "confirm") !== "yes") fail(path, "Tick the box to confirm.");
  const amount = money(form, "amount", path, "The amount cannot be negative.") ?? 0;
  const { supabase } = await ledgerCtx(path);
  const { error } = await supabase.rpc("dispose_fixed_asset", { p_asset: id, p_on: on, p_amount: amount, p_method: method });
  if (error) fail(path, error.message);
  revalidatePath("/accounts", "layout");
  redirect(withNotice(path, { msg: "The asset is out of the books." }));
}
