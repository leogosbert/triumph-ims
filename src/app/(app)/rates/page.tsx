import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { CURRENCIES } from "@/lib/lists";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { removeRate, saveRate } from "./actions";

export const metadata = { title: "Exchange rates" };

type Rate = { id: string; currency: string; rate: number; updated_at: string; updated_by: string | null };

export default async function RatesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  const edit = can(role, "seeFinance");
  const { data } = await supabase.from("exchange_rates").select("id, currency, rate, updated_at, updated_by").eq("company_id", company.id).order("currency");
  const rates = (data ?? []) as Rate[];
  const names = await namesFor(supabase, rates.map((r) => r.updated_by));
  const base = company.base_currency;

  return (
    <>
      <p className="small">
        <Link href={edit ? "/finance" : "/more"}>← {edit ? tr("Finance") : tr("More")}</Link>
      </p>
      <h1>{tr("Exchange rates")}</h1>
      <p className="muted small">{tr("How many")}{" "}{base}{" "}{tr("for 1 unit of each currency. Quotations, purchase orders, invoices, bills and costs in a foreign currency take this rate automatically, and can only differ from it by up to 10%. This keeps approval limits, credit limits and margins honest.")}{" "}{edit ? tr("Update rates when the bank rate moves.") : tr("Only management and finance can change them.")}
      </p>
      <Notice {...notice} />
      <section className="card">
        {rates.length === 0 ? (
          <p className="muted small">{tr("No foreign currencies yet. Add one before quoting, buying or invoicing in it.")}</p>
        ) : (
          <ul className="list">
            {rates.map((r) => (
              <li key={r.id} className="row">
                <span>
                  <strong>1 {r.currency}</strong> = {base} {Number(r.rate).toLocaleString("en-GB", { maximumFractionDigits: 6 })}
                  <div className="small muted">{tr("Updated")}{" "}{formatDateTime(r.updated_at)}
                    {r.updated_by && ` by ${names.get(r.updated_by)}`}
                  </div>
                </span>
                {edit && (
                  <form action={removeRate}>
                    <input type="hidden" name="id" value={r.id} />
                    <SubmitButton className="btn btn-small btn-danger" pendingText="…">{tr("Remove")}</SubmitButton>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {edit && (
        <form action={saveRate} className="card">
          <h2>{tr("Add or update a rate")}</h2>
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="currency">{tr("Currency")}</label>
              <select id="currency" name="currency" defaultValue="USD">
                {CURRENCIES.filter((c) => c !== base).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="rate">
                {base}{" "}{tr("per 1 unit")}{" "}<span className="hint">{tr("· e.g. 2600 for USD")}</span>
              </label>
              <input id="rate" name="rate" type="text" inputMode="decimal" required />
            </div>
          </div>
          <SubmitButton pendingText={tr("Saving…")}>{tr("Save rate")}</SubmitButton>
        </form>
      )}
    </>
  );
}
