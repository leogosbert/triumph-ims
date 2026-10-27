import { displayName, type Profile } from "@/lib/context";
import { rolesOf, type Role } from "@/lib/roles";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Active team members of a company, with display names, main role and all their roles (main + extra). */
export async function companyPeople(supabase: Supabase, companyId: string) {
  const { data: members } = await supabase
    .from("memberships")
    // "*": extra_roles once the multiple-roles SQL has been run.
    .select("*")
    .eq("company_id", companyId)
    .eq("active", true);
  const rows = (members ?? []) as { user_id: string; role: Role; extra_roles?: Role[] | null }[];
  const roleOf = new Map(rows.map((m) => [m.user_id, m.role as string]));
  const rolesFor = new Map(rows.map((m) => [m.user_id, rolesOf(m.role, m.extra_roles)]));
  const ids = [...roleOf.keys()];
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email, phone").in("id", ids)
    : { data: [] };
  const people = ((profiles ?? []) as Profile[]).map((p) => ({ id: p.id, name: displayName(p), role: roleOf.get(p.id) ?? "", roles: rolesFor.get(p.id) ?? [] }));
  people.sort((a, b) => a.name.localeCompare(b.name));
  return people;
}

/** Names for a set of user ids (any company member, including former ones). */
export async function namesFor(supabase: Supabase, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, string>();
  if (!unique.length) return map;
  const { data } = await supabase.from("profiles").select("id, full_name, email, phone").in("id", unique);
  for (const p of (data ?? []) as Profile[]) map.set(p.id, displayName(p));
  return map;
}
