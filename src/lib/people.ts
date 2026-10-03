import { displayName, type Profile } from "@/lib/context";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Active team members of a company, with display names. */
export async function companyPeople(supabase: Supabase, companyId: string) {
  const { data: members } = await supabase
    .from("memberships")
    .select("user_id, role")
    .eq("company_id", companyId)
    .eq("active", true);
  const roleOf = new Map(((members ?? []) as { user_id: string; role: string }[]).map((m) => [m.user_id, m.role]));
  const ids = [...roleOf.keys()];
  const { data: profiles } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email, phone").in("id", ids)
    : { data: [] };
  const people = ((profiles ?? []) as Profile[]).map((p) => ({ id: p.id, name: displayName(p), role: roleOf.get(p.id) ?? "" }));
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
