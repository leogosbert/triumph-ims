import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { daysOverdue, openBase } from "@/lib/finance";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";

export const metadata = { title: "Statements" };

type Open = { party_id: string; name: string; total: number; late: number };

function group(rows: { pid: string; name: string; due_date: string | null; total: number; amount_paid: number; exchange_rate: number }[]) {
  const map = new Map<string, Open>();
  for (const r of rows) {
    const g = map.get(r.pid) ?? { party_id: r.pid, name: r.name, total: 0, late: 0 };
    const v = openBase(r);
    g.total += v;
    if (daysOverdue(r.due_date) > 0) g.late += v;
    map.set(r.pid, g);
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

export default async function StatementsPage() {
  await primeLang();
  const { supabase, company, role } = await getAppContext();
  const seeClients = can(role, "seeInvoices");
  const seeSuppliers = can(role, "seeBills");
  if (!seeClients && !seeSuppliers) redirect("/");
  const base = company.base_currency;

  const [{ data: inv }, { data: bills }, { data: cl }, { data: su }] = await Promise.all([
    seeClients
      ? supabase
          .from("invoices")
          .select("client_id, due_date, total, amount_paid, exchange_rate, client:clients(name)")
          .eq("company_id", company.id)
          .in("status", ["issued", "partly_paid"])
          .limit(5000)
      : Promise.resolve({ data: [] }),
    seeSuppliers
      ? supabase
          .from("supplier_bills")
          .select("supplier_id, due_date, total, amount_paid, exchange_rate, supplier:suppliers(name)")
          .eq("company_id", company.id)
          .in("status", ["open", "partly_paid"])
          .limit(5000)
      : Promise.resolve({ data: [] }),
    seeClients ? supabase.from("clients").select("id, name").eq("company_id", company.id).order("name").limit(3000) : Promise.resolve({ data: [] }),
    seeSuppliers ? supabase.from("suppliers").select("id, name").eq("company_id", company.id).order("name").limit(3000) : Promise.resolve({ data: [] }),
  ]);
  type R = { due_date: string | null; total: number; amount_paid: number; exchange_rate: number };
  const clients = group(
    ((inv ?? []) as unknown as (R & { client_id: string; client: { name: string } | null })[]).map((r) => ({ ...r, pid: r.client_id, name: r.client?.name ?? "" })),
  );
  const suppliers = group(
    ((bills ?? []) as unknown as (R & { supplier_id: string; supplier: { name: string } | null })[]).map((r) => ({ ...r, pid: r.supplier_id, name: r.supplier?.name ?? "" })),
  );

  const Block = ({ title, rows, kind, all }: { title: string; rows: Open[]; kind: "clients" | "suppliers"; all: { id: string; name: string }[] }) => (
    <section className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted small">{tr("Nothing open.")}</p>
      ) : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.party_id} className="row">
              <Link href={`/${kind}/${r.party_id}/statement`}>{r.name}</Link>
              <span className="small">
                {formatMoney(r.total, base)}
                {r.late > 0 && (
                  <span className="text-warn">
                    {" "}
                    · {formatMoney(r.late, base)} {tr("overdue")}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {all.length > 0 && (
        <form method="get" action={`/${kind}/statement-go`} className="inline-form" style={{ marginTop: 10 }}>
          <select name="id" aria-label={tr("Choose")} defaultValue="">
            <option value="" disabled>
              {kind === "clients" ? tr("Any client…") : tr("Any supplier…")}
            </option>
            {all.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn btn-small">
            {tr("Open statement")}
          </button>
        </form>
      )}
    </section>
  );

  return (
    <>
      <p className="small">
        <Link href="/finance">{tr("← Finance")}</Link>
      </p>
      <h1>{tr("Statements")}</h1>
      <p className="muted small">{tr("A statement lists every invoice (or bill) and payment for a period with the running balance. Send it to a client to agree what they owe, or compare it with a supplier's statement.")}</p>
      {seeClients && <Block title={tr("Clients who owe us")} rows={clients} kind="clients" all={(cl ?? []) as { id: string; name: string }[]} />}
      {seeSuppliers && <Block title={tr("Suppliers we owe")} rows={suppliers} kind="suppliers" all={(su ?? []) as { id: string; name: string }[]} />}
    </>
  );
}
