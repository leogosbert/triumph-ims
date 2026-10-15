"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireManager } from "@/lib/context";
import { str } from "@/lib/format";
import { friendlyError, withNotice } from "@/lib/messages";

/** Goods, services or both: switches the matching features on (or the service screens off). */
export async function setBusinessType(form: FormData) {
  const { supabase, company } = await requireManager();
  const back = str(form, "back").startsWith("/") ? str(form, "back") : "/settings/features#sell";
  const type = str(form, "business_type");
  const { error } = await supabase.rpc("set_business_type", { p_company: company.id, p_type: type });
  if (error) redirect(withNotice(back, { error: friendlyError(error.message) }));
  revalidatePath("/", "layout");
  redirect(
    withNotice(back, {
      msg:
        type === "goods"
          ? "Saved: goods. The service screens are switched off; switch any back on below."
          : "Saved. The service screens are switched on; switch off what you don't need below.",
    }),
  );
}
