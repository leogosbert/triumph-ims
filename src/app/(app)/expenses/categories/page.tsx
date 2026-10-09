import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, stage13Ready } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { addCategory, updateCategory } from "../actions";

export const metadata = { title: "Expense categories" };

export default async function CategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "manageExpenses") || !stage13Ready(company)) redirect("/expenses");
  const { data } = await supabase
    .from("expense_categories")
    .select("id, name, active")
    .eq("company_id", company.id)
    .order("active", { ascending: false })
    .order("sort")
    .order("name");
  const rows = (data ?? []) as { id: string; name: string; active: boolean }[];

  return (
    <>
      <p className="small">
        <Link href="/expenses">{tr("← Expenses")}</Link>
      </p>
      <h1>{tr("Expense categories")}</h1>
      <p className="muted small">{tr("Rename the categories to match how you think about your spending. A category that is switched off is hidden when recording new expenses; old expenses keep it.")}</p>
      <Notice {...notice} />
      <form action={addCategory} className="card inline-form">
        <input name="name" type="text" required minLength={2} maxLength={60} placeholder={tr("New category name")} aria-label={tr("New category name")} />
        <SubmitButton className="btn btn-primary btn-small">{tr("Add")}</SubmitButton>
      </form>
      <ul className="list card">
        {rows.map((c) => (
          <li key={c.id}>
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <form action={updateCategory} className="inline-form" style={{ flex: 1 }}>
                <input type="hidden" name="id" value={c.id} />
                <input name="name" type="text" defaultValue={c.name} required minLength={2} maxLength={60} aria-label={tr("Name")} className={c.active ? undefined : "muted"} />
                <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
              </form>
              <form action={updateCategory}>
                <input type="hidden" name="id" value={c.id} />
                <input type="hidden" name="active" value={c.active ? "false" : "true"} />
                <SubmitButton className="btn btn-small">{c.active ? tr("Switch off") : tr("Switch on")}</SubmitButton>
              </form>
            </div>
            {c.name !== tr(c.name) && <div className="small muted">{tr(c.name)}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
