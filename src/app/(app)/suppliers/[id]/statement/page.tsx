import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { StatementView } from "@/components/StatementView";
import { getAppContext } from "@/lib/context";
import { methodLabel } from "@/lib/finance";
import { type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { cleanDate, defaultPeriod, loadStatement } from "@/lib/statements";

export const metadata = { title: "Supplier statement" };

export default async function SupplierStatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeBills")) redirect("/");
  const { data: client } = await supabase.from("suppliers").select("id, name, code").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!client) notFound();
  const def = defaultPeriod();
  const s = await loadStatement(
    supabase,
    company.id,
    "supplier",
    id,
    cleanDate(sp.from, def.from),
    cleanDate(sp.to, def.to),
    typeof sp.ccy === "string" ? sp.ccy : company.base_currency,
    (m) => tr(methodLabel(m)),
  );
  return (
    <>
      <p className="small">
        <Link href={`/suppliers/${id}`}>← {client.name}</Link>
      </p>
      <h1>{tr("Statement of account")}</h1>
      <p className="muted small">
        {client.name} · {client.code}
      </p>
      <StatementView s={s} path={`/suppliers/${id}/statement`} kind="supplier" />
    </>
  );
}
