import { getAppContext } from "@/lib/context";
import { toCsv } from "@/lib/exportData";
import type { PayrollLine } from "@/lib/payroll";
import { can } from "@/lib/roles";

export const dynamic = "force-dynamic";

/** /payroll/[id]/export/payments | paye | nssf — CSV lists for the bank, TRA and NSSF (management and finance). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "runPayroll")) return new Response("Not allowed", { status: 403 });
  if (!["payments", "paye", "nssf"].includes(kind)) return new Response("Unknown list", { status: 404 });
  const { data: run } = await supabase.from("payroll_runs").select("number, period").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!run) return new Response("Pay run not found", { status: 404 });
  const { data } = await supabase.from("payroll_lines").select("*").eq("run_id", id).order("employee_name");
  const lines = (data ?? []) as PayrollLine[];
  const { data: empData } = lines.length
    ? await supabase.from("employees").select("id, tin, nssf_no").in("id", lines.map((l) => l.employee_id))
    : { data: [] };
  const emp = new Map(((empData ?? []) as { id: string; tin: string | null; nssf_no: string | null }[]).map((e) => [e.id, e]));

  let rows: Record<string, unknown>[];
  if (kind === "payments") {
    rows = lines.map((l) => ({
      name: l.employee_name,
      employee_no: l.employee_no ?? "",
      method: l.pay_method ?? "",
      account: l.pay_account ?? "",
      net: Number(l.net),
    }));
  } else if (kind === "paye") {
    rows = lines.map((l) => ({
      name: l.employee_name,
      tin: emp.get(l.employee_id)?.tin ?? "",
      gross: Number(l.gross),
      taxable: Number(l.taxable),
      paye: Number(l.paye),
    }));
  } else {
    rows = lines.map((l) => ({
      name: l.employee_name,
      nssf_no: emp.get(l.employee_id)?.nssf_no ?? "",
      gross: Number(l.gross),
      employee: Number(l.nssf_employee),
      employer: Number(l.nssf_employer),
      total: Number(l.nssf_employee) + Number(l.nssf_employer),
    }));
  }
  const slug = company.name.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "");
  const month = String(run.period).slice(0, 7);
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}-payroll-${month}-${kind}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
