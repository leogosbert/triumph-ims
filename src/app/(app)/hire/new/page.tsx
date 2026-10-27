import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { RATE_PERIODS, canPlanService, todayTz } from "@/lib/services";
import { createHire } from "../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New hire" };

export default async function NewHirePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!canPlanService(role)) redirect("/hire");
  const probe = await supabase.from("hire_agreements").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="New hire" />;
  const clients = await clientOptions(supabase, company.id);
  const preset = typeof sp.client === "string" ? sp.client : "";

  return (
    <>
      <BackLink href="/hire" label="Equipment hire" />
      <h1>{tr("New hire")}</h1>
      <Notice {...notice} />
      <form action={createHire} className="card">
        <div className="grid grid-2">
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="client_id">{tr("Client")}</label>
            <select id="client_id" name="client_id" required defaultValue={preset}>
              <option value="" disabled>
                {tr("Choose…")}
              </option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="site">{tr("Site")}</label>
            <input id="site" name="site" type="text" maxLength={300} placeholder={tr("Where the equipment will be used")} />
          </div>
          <div className="field">
            <label htmlFor="contact">{tr("Contact on site")}</label>
            <input id="contact" name="contact" type="text" maxLength={200} placeholder={tr("Name and phone")} />
          </div>
          <div className="field">
            <label htmlFor="out_on">{tr("Date out")}</label>
            <input id="out_on" name="out_on" type="date" required defaultValue={todayTz()} />
          </div>
          <div className="field">
            <label htmlFor="due_back_on">{tr("Due back")}</label>
            <input id="due_back_on" name="due_back_on" type="date" />
          </div>
          <div className="field">
            <label htmlFor="rate_period">{tr("Rate")}</label>
            <select id="rate_period" name="rate_period" defaultValue="day">
              {Object.entries(RATE_PERIODS).map(([k, v]) => (
                <option key={k} value={k}>
                  {tr(v.label)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="deposit">{tr("Deposit")}</label>
            <input id="deposit" name="deposit" type="text" inputMode="decimal" />
          </div>
          <div className="field">
            <label htmlFor="currency">{tr("Currency")}</label>
            <input id="currency" name="currency" type="text" maxLength={3} defaultValue={company.base_currency} style={{ textTransform: "uppercase" }} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="notes">{tr("Notes")}</label>
            <textarea id="notes" name="notes" rows={3} maxLength={2000} />
          </div>
        </div>
        <p className="muted small">{tr("You add the items and their rates on the next screen.")}</p>
        <SubmitButton>{tr("Save and add items")}</SubmitButton>
      </form>
    </>
  );
}
