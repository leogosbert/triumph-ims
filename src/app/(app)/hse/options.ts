import type { createClient } from "@/lib/supabase/server";
import type { Option } from "@/lib/hse";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type LinkOptions = {
  employees: Option[];
  clients: Option[];
  projects: Option[];
  jobs: Option[];
  vehicles: Option[];
};

type Row = Record<string, string | null>;
const rows = (r: { data: unknown }) => (r.data ?? []) as Row[];

/**
 * Recent active records a health & safety record can point at. Each list holds only what
 * this person may read (row-level security), so lists can be empty; empty lists are not shown.
 */
export async function loadLinkOptions(supabase: Supabase, companyId: string, withPeople: boolean): Promise<LinkOptions> {
  const [emp, cli, prj, job, veh] = await Promise.all([
    withPeople
      ? supabase.from("employees").select("id, full_name").eq("company_id", companyId).eq("status", "active").order("full_name").limit(500)
      : Promise.resolve({ data: [] }),
    supabase.from("clients").select("id, name").eq("company_id", companyId).eq("active", true).order("name").limit(200),
    supabase.from("projects").select("id, number, name").eq("company_id", companyId).eq("status", "active").order("created_at", { ascending: false }).limit(200),
    supabase
      .from("service_jobs")
      .select("id, number, title")
      .eq("company_id", companyId)
      .in("status", ["scheduled", "in_progress", "on_hold", "completed"])
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("vehicles").select("id, plate, name").eq("company_id", companyId).eq("active", true).order("plate").limit(200),
  ]);
  return {
    employees: rows(emp).map((r) => ({ id: r.id!, label: r.full_name ?? "" })),
    clients: rows(cli).map((r) => ({ id: r.id!, label: r.name ?? "" })),
    projects: rows(prj).map((r) => ({ id: r.id!, label: [r.number, r.name].filter(Boolean).join(" · ") })),
    jobs: rows(job).map((r) => ({ id: r.id!, label: [r.number, r.title].filter(Boolean).join(" · ") })),
    vehicles: rows(veh).map((r) => ({ id: r.id!, label: [r.plate, r.name].filter(Boolean).join(" · ") })),
  };
}

/** Names of the records one row already points at (to show them and keep them selectable). */
export async function linkedNames(
  supabase: Supabase,
  ids: { employee_id?: string | null; client_id?: string | null; project_id?: string | null; job_id?: string | null; vehicle_id?: string | null },
) {
  const one = async (table: string, cols: string, id: string | null | undefined, label: (r: Row) => string) => {
    if (!id) return null;
    const { data } = await supabase.from(table).select(cols).eq("id", id).maybeSingle();
    return data ? label(data as unknown as Row) : null;
  };
  const [employee, client, project, job, vehicle] = await Promise.all([
    one("employees", "full_name", ids.employee_id, (r) => r.full_name ?? ""),
    one("clients", "name", ids.client_id, (r) => r.name ?? ""),
    one("projects", "number, name", ids.project_id, (r) => [r.number, r.name].filter(Boolean).join(" · ")),
    one("service_jobs", "number, title", ids.job_id, (r) => [r.number, r.title].filter(Boolean).join(" · ")),
    one("vehicles", "plate, name", ids.vehicle_id, (r) => [r.plate, r.name].filter(Boolean).join(" · ")),
  ]);
  return { employee, client, project, job, vehicle };
}
