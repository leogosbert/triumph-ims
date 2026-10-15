import { cookies } from "next/headers";
import { isMissingSql } from "@/components/suggestions/meta";
import { ACTIVE_COMPANY_COOKIE } from "@/lib/context";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/supabase/user";

export type PlaybookState = "granted" | "requested" | "declined" | "ended" | null;

export type PlaybookAccess = {
  signedIn: boolean;
  /** The company the person is working in (null when signed out or without a company). */
  companyId: string | null;
  /** False before the services & billing SQL is run: then every playbook stays open, as before. */
  ready: boolean;
  /** LeMo Tech staff read every playbook. */
  admin: boolean;
  state: (playbookId: string) => PlaybookState;
  /** Price book key for requesting a playbook. */
  itemKey: (playbookId: string) => string | null;
  note: (playbookId: string) => string | null;
};

/**
 * Who may read which playbook. Playbooks are given to a company by LeMo Tech on request
 * (service_requests); demo companies and LeMo Tech staff have all of them.
 */
export async function playbookAccess(): Promise<PlaybookAccess> {
  const supabase = await createClient();
  const user = await getSessionUser(supabase);
  const closed: PlaybookAccess = {
    signedIn: Boolean(user),
    companyId: null,
    ready: true,
    admin: false,
    state: () => null,
    itemKey: () => null,
    note: () => null,
  };
  if (!user) return closed;

  const chosen = (await cookies()).get(ACTIVE_COMPANY_COOKIE)?.value;
  const [{ data: ms }, { data: isAdmin }] = await Promise.all([
    supabase.from("memberships").select("company_id, created_at").eq("user_id", user.id).eq("active", true).order("created_at"),
    supabase.rpc("is_platform_admin"),
  ]);
  const list = (ms ?? []) as { company_id: string }[];
  const companyId = list.find((m) => m.company_id === chosen)?.company_id ?? list[0]?.company_id ?? null;
  const admin = isAdmin === true;
  if (!companyId) return { ...closed, admin, state: () => (admin ? "granted" : null) };

  const { data, error } = await supabase.rpc("company_playbooks", { p_company: companyId });
  if (error) {
    // Before the SQL is run, playbooks stay open as they were.
    const missing = isMissingSql(error);
    return { ...closed, companyId, admin, ready: !missing, state: () => (missing || admin ? "granted" : null) };
  }
  const rows = (data ?? []) as { playbook_id: string; item_key: string; state: PlaybookState; admin_note: string | null }[];
  const by = new Map(rows.map((r) => [r.playbook_id, r]));
  return {
    signedIn: true,
    companyId,
    ready: true,
    admin,
    state: (id) => (admin ? "granted" : (by.get(id)?.state ?? null)),
    itemKey: (id) => by.get(id)?.item_key ?? null,
    note: (id) => by.get(id)?.admin_note ?? null,
  };
}
