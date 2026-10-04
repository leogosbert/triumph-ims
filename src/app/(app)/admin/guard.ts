import { cache } from "react";
import { getAppContext } from "@/lib/context";
import { isMissingSql } from "@/components/suggestions/meta";

/**
 * Is the signed-in person a LeMo Tech platform admin?
 * Any error (including the Stage 11 SQL not being run yet) counts as "no".
 */
export const platformAdmin = cache(async () => {
  const ctx = await getAppContext();
  const { data, error } = await ctx.supabase.rpc("is_platform_admin");
  return { ok: !error && data === true, missingSql: isMissingSql(error), supabase: ctx.supabase };
});
