import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Role } from "@/lib/roles";

export const ACTIVE_COMPANY_COOKIE = "ims_company";

export type Company = {
  id: string;
  name: string;
  legal_name: string | null;
  tin: string | null;
  vrn: string | null;
  registration_no: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  base_currency: string;
  second_currency: string | null;
  primary_color: string;
  accent_color: string;
  logo_path: string | null;
  bank_details: string | null;
  document_footer: string | null;
  vat_rate: number;
  quote_validity_days: number;
  quote_min_margin_pct: number;
  quote_approval_above: number;
  quote_terms: string | null;
  po_approval_above: number;
  po_terms: string | null;
  /** Added in Stage 6; missing until that SQL has been run. */
  invoice_due_days?: number;
  invoice_terms?: string | null;
  created_at: string;
  updated_at: string;
};

export type Membership = {
  id: string;
  role: Role;
  company_id: string;
  company: Company;
};

export type Profile = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
};

/**
 * Everything a signed-in page needs: the user, their profile, the company
 * they are working in and their role there. Sends people to /login or
 * /welcome when they are not ready to use the app yet.
 */
export const getAppContext = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("memberships")
    .select("id, role, company_id, company:companies(*)")
    .eq("user_id", user.id)
    .eq("active", true)
    .order("created_at");
  if (error) {
    // The database tables don't exist yet: the setup SQL hasn't been run.
    if (error.code === "PGRST205" || error.code === "42P01" || /does not exist|schema cache/i.test(error.message)) {
      redirect("/setup-needed");
    }
    // Any other database refusal: show the real reason instead of a blank crash.
    redirect(
      `/setup-needed?code=${encodeURIComponent(error.code ?? "")}&detail=${encodeURIComponent(error.message ?? "")}`,
    );
  }

  const memberships = (data ?? []) as unknown as Membership[];
  if (memberships.length === 0) redirect("/welcome");

  const chosen = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value;
  const membership = memberships.find((m) => m.company_id === chosen) ?? memberships[0];

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone")
    .eq("id", user.id)
    .maybeSingle();
  const profile: Profile = (profileRow as Profile | null) ?? {
    id: user.id,
    full_name: null,
    email: user.email ?? null,
    phone: null,
  };

  return {
    supabase,
    user,
    profile,
    memberships,
    membership,
    company: membership.company,
    role: membership.role,
    isManager: membership.role === "management",
  };
});

/** Same as getAppContext, but only management may continue. */
export async function requireManager() {
  const ctx = await getAppContext();
  if (!ctx.isManager) {
    redirect(`/?error=${encodeURIComponent("Only management can open that page.")}`);
  }
  return ctx;
}

/** Public web address of a file in the "branding" storage bucket. */
export function brandingUrl(supabase: Awaited<ReturnType<typeof createClient>>, path: string | null) {
  if (!path) return null;
  return supabase.storage.from("branding").getPublicUrl(path).data.publicUrl;
}

export function displayName(p: { full_name: string | null; email: string | null } | null | undefined) {
  return p?.full_name?.trim() || p?.email || "Unknown user";
}
