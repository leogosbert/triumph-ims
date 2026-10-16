import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { PrintButton } from "@/components/reports/PrintButton";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDate } from "@/lib/format";
import { isDebitNature, isIsoDate, natural, toTbRows, typeLabel, yearStart, type Account } from "@/lib/ledger";
import { readNotice, type SearchParams } from "@/lib/messages";
import { todayTz } from "@/lib/services";
import { saveAccount, setAccountActive } from "../../actions";
import { partyNames, type LedgerLine } from "../../lines";
import { BackLink, amt, drCr, ledgerContext } from "../../shared";

export const metadata = { title: "Account" };

const MAX = 3000;

export default async function LedgerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const lang = await primeLang();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  const w = drCr(lang);
  const today = todayTz();
  const to = isIsoDate(sp.to) ? sp.to : today;
  const from = isIsoDate(sp.from) && sp.from <= to ? sp.from : yearStart(to);

  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: accData } = await supabase.from("gl_accounts").select("id, code, name, type, system_key, active, notes").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!accData) notFound();
  const a = accData as Account;

  const [tb, linesRes] = await Promise.all([
    supabase.rpc("gl_trial_balance", { p_company: company.id, p_from: from, p_to: to }),
    supabase
      .from("gl_lines")
      .select("id, account_id, debit, credit, description, client_id, supplier_id, gl_journals!inner(id, number, entry_date, doc_date, source, source_ref, memo)")
      .eq("account_id", id)
      .gte("gl_journals.entry_date", from)
      .lte("gl_journals.entry_date", to)
      .limit(MAX),
  ]);
  if (tb.error) throw new Error(tb.error.message);
  if (linesRes.error) throw new Error(linesRes.error.message);
  const row = toTbRows(tb.data).find((r) => r.account_id === id);
  const opening = natural(a.type, row?.opening ?? 0);
  const closing = natural(a.type, row?.closing ?? 0);
  const lines = (linesRes.data ?? []) as unknown as LedgerLine[];
  lines.sort((x, y) => x.gl_journals.entry_date.localeCompare(y.gl_journals.entry_date) || x.gl_journals.number.localeCompare(y.gl_journals.number));
  const names = await partyNames(supabase, lines);
  const sign = isDebitNature(a.type) ? 1 : -1;
  let running = opening;
  const q = new URLSearchParams({ from, to }).toString();

  return (
    <>
      <BackLink href="/accounts/chart" label="← Chart of accounts" />
      <h1 className="no-print">
        <span className="muted">{a.code}</span> {a.name}
      </h1>
      <p className="muted small no-print">
        {tr(typeLabel(a.type))} · {tr(isDebitNature(a.type) ? "Balance shown as a debit" : "Balance shown as a credit")}
        {a.system_key && " · LeMoSp"}
        {!a.active && ` · ${tr("Switched off")}`}
      </p>
      <Notice {...notice} />

      <form method="get" action={`/accounts/ledger/${id}`} className="card no-print">
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="from">{tr("From")}</label>
            <input id="from" name="from" type="date" defaultValue={from} required />
          </div>
          <div className="field">
            <label htmlFor="to">{tr("To")}</label>
            <input id="to" name="to" type="date" defaultValue={to} required />
          </div>
        </div>
        <button type="submit" className="btn btn-small">
          {tr("Show")}
        </button>
      </form>

      <section className="card report-print">
        <div className="rep-head">
          <p className="rep-company">{company.name}</p>
          <h2>
            {tr("Account statement")}: {a.code} {a.name}
          </h2>
          <p className="small">
            {formatDate(from)} – {formatDate(to)} · {tr("Amounts in")} {base}
          </p>
        </div>
        <div className="rep-actions no-print">
          <span className="small">
            {tr("Opening balance")}: <strong>{amt(opening, base)}</strong> · {tr("Closing balance")}: <strong>{amt(closing, base)}</strong>
          </span>
          <span className="rep-buttons">
            <PrintButton />
          </span>
        </div>
        {lines.length >= MAX && <p className="notice small">{tr("Only the first 3,000 lines are shown. Choose a shorter period.")}</p>}
        <div className="scroll-x">
          <table className="compare rep-table">
            <thead>
              <tr>
                <th>{tr("Date")}</th>
                <th>{tr("Journal")}</th>
                <th>{tr("Description")}</th>
                <th className="num">{w.dr}</th>
                <th className="num">{w.cr}</th>
                <th className="num">{tr("Balance")}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatDate(from)}</td>
                <td></td>
                <td>
                  <strong>{tr("Opening balance")}</strong>
                </td>
                <td></td>
                <td></td>
                <td className="num">
                  <strong>{amt(opening, base)}</strong>
                </td>
              </tr>
              {lines.map((l) => {
                const j = l.gl_journals;
                running += sign * (Number(l.debit) - Number(l.credit));
                const party = names.get(l.client_id ?? l.supplier_id ?? "");
                return (
                  <tr key={l.id}>
                    <td>{formatDate(j.entry_date)}</td>
                    <td>
                      <Link href={`/accounts/journals/${j.id}`}>{j.number}</Link>
                    </td>
                    <td>
                      {l.description || j.memo}
                      {party && <div className="small muted">{party}</div>}
                    </td>
                    <td className="num">{Number(l.debit) ? amt(Number(l.debit), base) : ""}</td>
                    <td className="num">{Number(l.credit) ? amt(Number(l.credit), base) : ""}</td>
                    <td className="num">{amt(running, base)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>{formatDate(to)}</td>
                <td></td>
                <td>{tr("Closing balance")}</td>
                <td className="num">{amt(lines.reduce((s, l) => s + Number(l.debit), 0), base)}</td>
                <td className="num">{amt(lines.reduce((s, l) => s + Number(l.credit), 0), base)}</td>
                <td className="num">{amt(lines.length >= MAX ? running : closing, base)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {lines.length === 0 && <p className="muted small">{tr("No entries in this period.")}</p>}
      </section>

      <details className="card no-print">
        <summary>{tr("Change this account")}</summary>
        <form action={saveAccount} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={a.id} />
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="code">{tr("Code (3 to 6 digits)")}</label>
              <input id="code" name="code" type="text" inputMode="numeric" pattern="[0-9]{3,6}" required defaultValue={a.code} />
            </div>
            <div className="field">
              <label htmlFor="name">{tr("Name")}</label>
              <input id="name" name="name" type="text" required minLength={2} maxLength={120} defaultValue={a.name} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="notes">{tr("Notes")}</label>
            <textarea id="notes" name="notes" maxLength={500} rows={2} defaultValue={a.notes ?? ""} />
          </div>
          <SubmitButton>{tr("Save")}</SubmitButton>
        </form>
        {!a.system_key && (
          <form action={setAccountActive} style={{ marginTop: 14 }}>
            <input type="hidden" name="id" value={a.id} />
            <input type="hidden" name="active" value={a.active ? "false" : "true"} />
            <p className="small muted">
              {tr(a.active ? "A switched-off account keeps its entries but cannot be chosen in new journals." : "Switch the account on to use it in journals again.")}
            </p>
            <SubmitButton className="btn btn-small">{tr(a.active ? "Switch off" : "Switch on")}</SubmitButton>
          </form>
        )}
      </details>
      <p className="small no-print">
        <Link href={`/accounts/trial-balance?${q}`}>{tr("Trial balance")}</Link>
      </p>
    </>
  );
}
