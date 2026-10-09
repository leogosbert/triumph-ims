"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

export async function saveBudget(form: FormData) {
  const year = Number(str(form, "year"));
  const line = str(form, "line");
  const path = `/budgets?y=${year}&line=${encodeURIComponent(line)}`;
  const fail: (e: string) => never = (e) => redirect(withNotice(path, { error: friendlyError(e) }));
  const [measure, category] = line.startsWith("cat:") ? ["expense_category", line.slice(4)] : [line, null];
  const same = str(form, "same");
  const amounts: (number | null)[] = [];
  for (let i = 1; i <= 12; i++) {
    const raw = same || str(form, `m${i}`);
    if (!raw) {
      amounts.push(null);
      continue;
    }
    const v = toNumber(raw);
    if (v === null || Number.isNaN(v) || v < 0) fail("Budgets must be numbers of zero or more.");
    amounts.push(v);
  }
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("set_budget", { p_company: company.id, p_year: year, p_measure: measure, p_category: category, p_amounts: amounts });
  if (error) fail(error.message);
  revalidatePath("/budgets");
  redirect(withNotice(path, { msg: "Budget saved." }));
}
