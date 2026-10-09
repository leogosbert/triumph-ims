import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";
import { createContract } from "../actions";
import { ContractFields } from "../ContractFields";

export const metadata = { title: "New contract" };

export default async function NewContractPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/contracts");
  const [{ data: tenders, error }, { data: clients }] = await Promise.all([
    supabase.from("tenders").select("id, number, title, reference, our_price, currency").eq("company_id", company.id).eq("status", "won").order("decided_at", { ascending: false }).limit(100),
    supabase.from("clients").select("id, name").eq("company_id", company.id).order("name").limit(3000),
  ]);
  if (isMissingTable(error)) return <NotReady title="New contract" />;
  const tenderId = typeof sp.tender === "string" ? sp.tender : null;
  const tender = tenders?.find((t) => t.id === tenderId);
  const today = todayTz();
  const nextYear = new Date(`${today}T00:00:00`);
  nextYear.setFullYear(nextYear.getFullYear() + 1);
  nextYear.setDate(nextYear.getDate() - 1);

  return (
    <>
      <p className="small">
        <Link href="/contracts">{tr("← Contracts")}</Link>
      </p>
      <h1>{tr("New contract")}</h1>
      <Notice {...notice} />
      <form action={createContract} className="card">
        <ContractFields
          creating
          v={{
            client_id: typeof sp.client === "string" ? sp.client : null,
            title: tender?.title,
            reference: tender?.reference ?? null,
            tender_id: tender?.id ?? null,
            value_cap: tender?.our_price ?? null,
            currency: tender?.currency ?? company.base_currency,
            start_date: today,
            end_date: nextYear.toISOString().slice(0, 10),
          }}
          clients={(clients ?? []) as { id: string; name: string }[]}
          tenders={(tenders ?? []) as { id: string; number: string; title: string }[]}
          base={company.base_currency}
        />
        <SubmitButton>{tr("Add contract")}</SubmitButton>
      </form>
    </>
  );
}
