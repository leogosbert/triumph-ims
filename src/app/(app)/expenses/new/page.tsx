import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { getAppContext, stage13Ready } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { todayTz } from "@/lib/sales";
import { NewExpenseForm } from "../NewExpenseForm";

export const metadata = { title: "New expense" };

export default async function NewExpensePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company } = await getAppContext();
  if (!stage13Ready(company)) {
    return (
      <>
        <h1>{tr("Record an expense")}</h1>
        <p className="card muted">{tr("This is not available yet. Ask LeMo Tech to run the latest database update.")}</p>
      </>
    );
  }
  const { data } = await supabase
    .from("expense_categories")
    .select("id, name, active")
    .eq("company_id", company.id)
    .order("sort")
    .order("name");
  const categories = (data ?? []) as { id: string; name: string; active: boolean }[];

  return (
    <>
      <p className="small">
        <Link href="/expenses">{tr("← Expenses")}</Link>
      </p>
      <h1>{tr("Record an expense")}</h1>
      <p className="muted small">{tr("Money paid out that is not a supplier bill: rent, fuel, airtime, wages, bank charges and the like.")}</p>
      <Notice {...notice} />
      <NewExpenseForm
        companyId={company.id}
        base={company.base_currency}
        categories={categories}
        withProvider
        start={{
          category_id: null,
          spent_on: todayTz(),
          payee: null,
          description: "",
          amount: null,
          vat_amount: 0,
          currency: company.base_currency,
          exchange_rate: 1,
          method: "cash",
          provider: null,
          reference: null,
          notes: null,
        }}
      />
    </>
  );
}
