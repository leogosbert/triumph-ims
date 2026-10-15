import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { companyPeople } from "@/lib/people";
import { canInvoiceService } from "@/lib/services";
import { saveTeamRate } from "../actions";

export const metadata = { title: "Team rates" };

type Rate = { user_id: string; bill_rate: number | null; cost_rate: number | null; title: string | null };

export default async function TeamRatesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!canInvoiceService(role)) redirect("/timesheets");
  const { data, error } = await supabase.from("team_rates").select("user_id, bill_rate, cost_rate, title").eq("company_id", company.id);
  if (isMissingTable(error)) return <NotReady title="Team rates" />;
  if (error) throw new Error(error.message);
  const rates = new Map(((data ?? []) as Rate[]).map((r) => [r.user_id, r]));
  const people = await companyPeople(supabase, company.id);
  const base = company.base_currency;

  return (
    <>
      <p className="small">
        <Link href="/timesheets">{tr("← Timesheets")}</Link>
      </p>
      <h1>{tr("Team rates")}</h1>
      <p className="muted small">
        {tr("The rate charged to clients for an hour of each person's work, and what that hour costs the company. A project's own hourly rate comes first. Hours already recorded keep the rate they were saved with.")}{" "}
        ({base})
      </p>
      <Notice {...notice} />
      <ul className="lines card">
        {people.map((p) => {
          const r = rates.get(p.id);
          const margin = r?.bill_rate != null && r?.cost_rate != null ? Number(r.bill_rate) - Number(r.cost_rate) : null;
          return (
            <li key={p.id}>
              <form action={saveTeamRate}>
                <input type="hidden" name="user_id" value={p.id} />
                <div className="line-head">
                  <span className="desc">{p.name}</span>
                  {margin != null && (
                    <span className="muted small" style={{ whiteSpace: "nowrap" }}>
                      {tr("Margin")} {formatMoney(margin, base)} / h
                    </span>
                  )}
                </div>
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor={`t-${p.id}`}>{tr("Job title")}</label>
                    <input id={`t-${p.id}`} name="title" type="text" maxLength={80} defaultValue={r?.title ?? ""} placeholder={tr("e.g. Senior engineer")} />
                  </div>
                  <div className="field">
                    <label htmlFor={`b-${p.id}`}>{tr("Charged per hour")}</label>
                    <input id={`b-${p.id}`} name="bill_rate" type="text" inputMode="decimal" defaultValue={r?.bill_rate ?? ""} />
                  </div>
                  <div className="field">
                    <label htmlFor={`c-${p.id}`}>{tr("Cost per hour")}</label>
                    <input id={`c-${p.id}`} name="cost_rate" type="text" inputMode="decimal" defaultValue={r?.cost_rate ?? ""} />
                  </div>
                </div>
                <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
              </form>
            </li>
          );
        })}
      </ul>
    </>
  );
}
