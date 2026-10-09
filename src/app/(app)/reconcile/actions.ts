"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

const KINDS = ["payment", "supplier_payment", "expense"] as const;

function back(form: FormData) {
  const q = new URLSearchParams();
  for (const k of ["m", "method", "show"]) if (str(form, k)) q.set(k, str(form, k));
  return `/reconcile?${q.toString()}`;
}

function refresh() {
  revalidatePath("/reconcile");
  revalidatePath("/expenses");
  revalidatePath("/payments");
}

/** Tick (or untick) the chosen payments and expenses as checked against the statement. */
export async function markChecked(form: FormData) {
  const { supabase, company } = await getAppContext();
  const done = str(form, "done") !== "0";
  const picks = form.getAll("pick").map(String);
  if (picks.length === 0) redirect(withNotice(back(form), { error: "Tick at least one line first." }));
  let changed = 0;
  for (const kind of KINDS) {
    const ids = picks.filter((p) => p.startsWith(`${kind}:`)).map((p) => p.slice(kind.length + 1));
    if (!ids.length) continue;
    const { data, error } = await supabase.rpc("set_reconciled", { p_company: company.id, p_kind: kind, p_ids: ids, p_done: done });
    if (error) redirect(withNotice(back(form), { error: friendlyError(error.message) }));
    changed += Number(data ?? 0);
  }
  refresh();
  redirect(withNotice(back(form), { msg: done ? `${changed} marked as checked.` : `${changed} unticked.` }));
}

/** Paste a bank or mobile-money statement: lines whose transaction code appears in it are ticked. */
export async function matchStatement(form: FormData) {
  const { supabase, company } = await getAppContext();
  const text = String(form.get("statement") ?? "");
  if (text.trim().length < 6) redirect(withNotice(back(form), { error: "Paste the statement text first." }));
  const method = str(form, "method");
  const { data, error } = await supabase.rpc("match_statement", {
    p_company: company.id,
    p_method: method && method !== "all" ? method : null,
    p_from: str(form, "from") || null,
    p_to: str(form, "to") || null,
    p_statement: text,
  });
  if (error) redirect(withNotice(back(form), { error: friendlyError(error.message) }));
  const matched = Number((data as { matched?: number } | null)?.matched ?? 0);
  refresh();
  redirect(
    withNotice(back(form), {
      msg: matched > 0 ? `${matched} found in the statement and marked as checked.` : "No recorded transaction codes were found in the statement.",
    }),
  );
}
