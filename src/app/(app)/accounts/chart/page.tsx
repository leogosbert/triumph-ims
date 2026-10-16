import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { isMissingTable } from "@/lib/crm";
import { ACCOUNT_TYPES, natural, toTbRows } from "@/lib/ledger";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { todayTz } from "@/lib/services";
import { addAccount } from "../actions";
import { BackLink, ledgerContext } from "../shared";

export const metadata = { title: "Chart of accounts" };

export default async function ChartPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  const showOff = sp.view === "all";

  const res = await supabase.rpc("gl_trial_balance", { p_company: company.id, p_from: null, p_to: todayTz() });
  if (isMissingTable(res.error)) return <NotReady title="Chart of accounts" />;
  if (res.error) throw new Error(res.error.message);
  const rows = toTbRows(res.data);
  const offCount = rows.filter((r) => !r.active).length;
  const shown = rows.filter((r) => showOff || r.active).sort((a, b) => a.code.localeCompare(b.code));

  return (
    <>
      <BackLink />
      <div className="page-head">
        <h1>{tr("Chart of accounts")}</h1>
        <a href="#add" className="btn btn-primary btn-small">
          {tr("+ Account")}
        </a>
      </div>
      <p className="muted small">
        {tr("Balances today. Accounts marked LeMoSp are posted to automatically and always stay on. Tap an account to see every entry.")}
      </p>
      <Notice {...notice} />
      {offCount > 0 && (
        <nav className="tabs-row" aria-label={tr("Show")}>
          <Link href="/accounts/chart" aria-current={!showOff ? "page" : undefined}>
            {tr("In use")}
          </Link>
          <Link href="/accounts/chart?view=all" aria-current={showOff ? "page" : undefined}>
            {tr("All")} ({rows.length})
          </Link>
        </nav>
      )}

      {ACCOUNT_TYPES.map((t) => {
        const list = shown.filter((r) => r.type === t.key);
        if (list.length === 0) return null;
        const total = list.reduce((s, r) => s + natural(r.type, r.closing), 0);
        return (
          <section key={t.key} className="card">
            <h2 style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{tr(t.label)}</span>
              <span className="small muted">{formatMoney(total, base)}</span>
            </h2>
            <ul className="rec-list">
              {list.map((r) => (
                <li key={r.account_id}>
                  <Link href={`/accounts/ledger/${r.account_id}`}>
                    <div className="main">
                      <div className="title">
                        <span className="muted">{r.code}</span> {r.name}
                      </div>
                      <div className="sub">
                        {r.system_key && <span className="badge tone-info">LeMoSp</span>}{" "}
                        {!r.active && <span className="badge tone-off">{tr("Switched off")}</span>}
                      </div>
                    </div>
                    <div className="side">{formatMoney(natural(r.type, r.closing), base)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <form action={addAccount} className="card" id="add">
        <h2>{tr("Add an account")}</h2>
        <p className="muted small">{tr("For example a bank loan, a second bank account or an expense you want to see on its own.")}</p>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="code">{tr("Code (3 to 6 digits)")}</label>
            <input id="code" name="code" type="text" inputMode="numeric" pattern="[0-9]{3,6}" required maxLength={6} placeholder="2310" />
          </div>
          <div className="field">
            <label htmlFor="name">{tr("Name")}</label>
            <input id="name" name="name" type="text" required minLength={2} maxLength={120} placeholder={tr("e.g. Bank loan CRDB")} />
          </div>
          <div className="field">
            <label htmlFor="type">{tr("Type")}</label>
            <select id="type" name="type" defaultValue="expense">
              {ACCOUNT_TYPES.map((t) => (
                <option key={t.key} value={t.key}>
                  {tr(t.one)}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="notes">{tr("Notes")}</label>
            <input id="notes" name="notes" type="text" maxLength={500} />
          </div>
        </div>
        <p className="small muted">{tr("Codes: 1xxx assets, 2xxx liabilities, 3xxx equity, 4xxx income, 5xxx–6xxx expenses.")}</p>
        <SubmitButton>{tr("Add account")}</SubmitButton>
      </form>
    </>
  );
}
