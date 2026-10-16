import { primeLang, tr } from "@/lib/tr";
import { NotReady } from "@/components/NotReady";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { ACCOUNT_TYPES, type Account } from "@/lib/ledger";
import { todayTz } from "@/lib/services";
import { BackLink, drCr, ledgerContext } from "../../shared";
import { JournalForm } from "./JournalForm";

export const metadata = { title: "New journal" };

export default async function NewJournalPage() {
  const lang = await primeLang();
  const { supabase, company, closedUntil } = await ledgerContext();
  const { data, error } = await supabase
    .from("gl_accounts")
    .select("id, code, name, type, system_key, active, notes")
    .eq("company_id", company.id)
    .eq("active", true)
    .order("code");
  if (isMissingTable(error)) return <NotReady title="New journal" />;
  if (error) throw new Error(error.message);
  const order = ACCOUNT_TYPES.map((t) => t.key as string);
  const accounts = ((data ?? []) as Account[])
    .sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || a.code.localeCompare(b.code))
    .map((a) => ({ id: a.id, label: `${a.code} ${a.name}`, type: a.type }));
  const groups = ACCOUNT_TYPES.map((t) => ({ key: t.key, label: tr(t.label) }));

  return (
    <>
      <BackLink href="/accounts/journals" label="← Journals" />
      <h1>{tr("New journal")}</h1>
      <p className="muted small">
        {tr("Use a journal for adjustments your accountant asks for, loans, capital, and the balances on the day you started. Invoices, payments, bills and expenses are posted for you: do not enter them again here.")}
      </p>
      {closedUntil && (
        <p className="banner warn small">
          {tr("The books are closed until")} {formatDate(closedUntil)}. {tr("Choose a later date.")}
        </p>
      )}
      <JournalForm accounts={accounts} groups={groups} today={todayTz()} currency={company.base_currency} words={drCr(lang)} />
    </>
  );
}
