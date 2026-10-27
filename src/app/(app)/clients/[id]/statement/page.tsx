import { primeLang, tr } from "@/lib/tr";
import { notFound, redirect } from "next/navigation";
import { StatementView } from "@/components/StatementView";
import { getAppContext } from "@/lib/context";
import { methodLabel } from "@/lib/finance";
import { type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { cleanDate, defaultPeriod, loadStatement } from "@/lib/statements";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Client statement" };

export default async function ClientStatementPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "seeInvoices")) redirect("/");
  const { data: client } = await supabase.from("clients").select("id, name, code").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!client) notFound();
  const def = defaultPeriod();
  const s = await loadStatement(
    supabase,
    company.id,
    "client",
    id,
    cleanDate(sp.from, def.from),
    cleanDate(sp.to, def.to),
    typeof sp.ccy === "string" ? sp.ccy : company.base_currency,
    (m) => tr(methodLabel(m)),
  );
  return (
    <>
      <BackLink href={`/clients/${id}`} label={client.name} />
      <h1>{tr("Statement of account")}</h1>
      <p className="muted small">
        {client.name} · {client.code}
      </p>
      <StatementView s={s} path={`/clients/${id}/statement`} kind="client" />
    </>
  );
}
