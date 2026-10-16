import { loadFeatures } from "@/lib/features";
import { createClient } from "@/lib/supabase/server";
import type { PlaybookProfile } from "./personalize";

/** What a playbook needs to know about the reader's company (null when it cannot be read). */
export async function playbookProfile(companyId: string | null): Promise<PlaybookProfile | null> {
  if (!companyId) return null;
  const supabase = await createClient();
  const [{ data }, features] = await Promise.all([
    supabase.from("companies").select("*").eq("id", companyId).maybeSingle(),
    loadFeatures(supabase, companyId),
  ]);
  if (!data) return null;
  const c = data as Record<string, unknown>;
  const s = (k: string) => (typeof c[k] === "string" && (c[k] as string).trim() ? (c[k] as string) : null);
  const level = c.business_level;
  const type = c.business_type;
  return {
    name: s("name") ?? "",
    level: level === "small" || level === "medium" || level === "enterprise" ? level : undefined,
    businessType: type === "goods" || type === "services" || type === "both" ? type : undefined,
    featuresReady: features.ready,
    featureOn: features.on,
    tin: s("tin"),
    vrn: s("vrn"),
    registrationNo: s("registration_no"),
    mining: /\b(mining|mines?|madini|drilling)\b/i.test(`${s("name") ?? ""} ${s("legal_name") ?? ""}`),
  };
}
