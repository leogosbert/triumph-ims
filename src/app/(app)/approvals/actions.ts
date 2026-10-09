"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { STEP_ROLES } from "@/lib/branches";
import { getAppContext } from "@/lib/context";
import { toNumber } from "@/lib/fields";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

const fail = (error: string): never => redirect(withNotice("/approvals", { error: friendlyError(error) }));

export async function saveSteps(form: FormData) {
  const steps: { role: string; min_amount: number; label: string }[] = [];
  for (let i = 1; i <= 6; i++) {
    const role = str(form, `role${i}`);
    if (!role) continue;
    if (!(STEP_ROLES as readonly string[]).includes(role)) fail("Choose who approves each step.");
    const min = toNumber(str(form, `min${i}`));
    if (min !== null && (Number.isNaN(min) || min < 0)) fail("The amounts must be numbers of zero or more.");
    steps.push({ role, min_amount: min ?? 0, label: str(form, `label${i}`) });
  }
  const { supabase, company } = await getAppContext();
  const { error } = await supabase.rpc("set_approval_steps", { p_company: company.id, p_doc_type: "purchase_order", p_steps: steps });
  if (error) fail(error.message);
  revalidatePath("/approvals");
  redirect(
    withNotice("/approvals", {
      msg: steps.length ? "Approval steps saved. They apply to purchase orders submitted from now on." : "Steps removed. Purchase orders use the single management approval again.",
    }),
  );
}
