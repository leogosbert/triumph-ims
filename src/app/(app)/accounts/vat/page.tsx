import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { NotReady } from "@/components/NotReady";
import { PrintButton } from "@/components/reports/PrintButton";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { addMonths, monthEnd, monthLabel, readMonth, sourceLabel } from "@/lib/ledger";
import { type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { todayTz } from "@/lib/services";
import { BackLink, amt, ledgerContext } from "../shared";
import { partyNames, type LedgerLine } from "../lines";

export const metadata = { title: "VAT return" };

export default async function VatPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  const today = todayTz();
  const ym = readMonth(sp.m, today.slice(0, 7));
  const start = `${ym}-01`;
  const end = monthEnd(start);
  const prevM = addMonths(start, -1).slice(0, 7);
  const nextM = addMonths(start, 1).slice(0, 7);
  const dueBy = `${nextM}-20`;

  const accRes = await supabase.from("gl_accounts").select("id, system_key").eq("company_id", company.id).in("system_key", ["vat_output", "vat_input"]);
  if (isMissingTable(accRes.error)) return <NotReady title="VAT return" />;
  if (accRes.error) throw new Error(accRes.error.message);
  const acc = (accRes.data ?? []) as { id: string; system_key: string }[];
  const outId = acc.find((a) => a.system_key === "vat_output")?.id;
  const inId = acc.find((a) => a.system_key === "vat_input")?.id;

  let lines: LedgerLine[] = [];
  if (acc.length) {
    const { data, error } = await supabase
      .from("gl_lines")
      .select("id, account_id, debit, credit, description, client_id, supplier_id, gl_journals!inner(id, number, entry_date, doc_date, source, source_ref, memo)")
      .eq("company_id", company.id)
      .in("account_id", acc.map((a) => a.id))
      .gte("gl_journals.entry_date", start)
      .lte("gl_journals.entry_date", end)
      .limit(5000);
    if (error) throw new Error(error.message);
    lines = (data ?? []) as unknown as LedgerLine[];
    lines.sort((a, b) => a.gl_journals.entry_date.localeCompare(b.gl_journals.entry_date) || a.gl_journals.number.localeCompare(b.gl_journals.number));
  }
  const names = await partyNames(supabase, lines);
  const outLines = lines.filter((l) => l.account_id === outId);
  const inLines = lines.filter((l) => l.account_id === inId);
  const output = outLines.reduce((s, l) => s + Number(l.credit) - Number(l.debit), 0);
  const input = inLines.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
  const payable = output - input;

  const List = ({ title, rows, sign }: { title: string; rows: LedgerLine[]; sign: 1 | -1 }) => (
    <>
      <h3>{tr(title)}</h3>
      {rows.length === 0 ? (
        <p className="muted small">{tr("Nothing this month.")}</p>
      ) : (
        <div className="scroll-x">
          <table className="compare rep-table">
            <thead>
              <tr>
                <th>{tr("Date")}</th>
                <th>{tr("Document")}</th>
                <th>{tr("Client or supplier")}</th>
                <th className="num">{tr("VAT")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const j = l.gl_journals;
                const v = sign * (Number(l.credit) - Number(l.debit));
                return (
                  <tr key={l.id}>
                    <td>{formatDate(j.doc_date ?? j.entry_date)}</td>
                    <td>
                      <Link href={`/accounts/journals/${j.id}`}>{j.source_ref ?? j.number}</Link>
                      <div className="small muted">
                        {tr(sourceLabel(j.source))} · {j.memo ?? ""}
                      </div>
                    </td>
                    <td>{names.get(l.client_id ?? l.supplier_id ?? "") ?? ""}</td>
                    <td className="num">{amt(v, base)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );

  return (
    <>
      <BackLink />
      <h1 className="no-print">{tr("VAT return")}</h1>
      <nav className="tabs-row no-print" aria-label={tr("Month")}>
        <Link href={`/accounts/vat?m=${prevM}`}>{tr("← Earlier")}</Link>
        <Link href={`/accounts/vat?m=${ym}`} aria-current="page">
          {monthLabel(ym, tr)}
        </Link>
        {ym < today.slice(0, 7) && <Link href={`/accounts/vat?m=${nextM}`}>{tr("Later →")}</Link>}
      </nav>

      <section className="card report-print">
        <div className="rep-head">
          <p className="rep-company">{company.name}</p>
          <h2>
            {tr("VAT return")} · {monthLabel(ym, tr)}
          </h2>
          <p className="small">
            {company.tin && `TIN ${company.tin} · `}
            {company.vrn && `VRN ${company.vrn} · `}
            {tr("Amounts in")} {base}
          </p>
        </div>
        <div className="rep-actions no-print">
          <span className="small">
            {tr("File the return with TRA by")} <strong>{formatDate(dueBy)}</strong>
          </span>
          <span className="rep-buttons">
            <PrintButton />
          </span>
        </div>
        <div className="stat-grid">
          <div className="stat">
            <div className="n">{formatMoney(output, base)}</div>
            <div className="l">{tr("VAT output (on sales)")}</div>
          </div>
          <div className="stat">
            <div className="n">{formatMoney(input, base)}</div>
            <div className="l">{tr("VAT input (on purchases)")}</div>
          </div>
          <div className={`stat${payable > 0 ? " alert" : ""}`}>
            <div className="n">{formatMoney(Math.abs(payable), base)}</div>
            <div className="l">{tr(payable >= 0 ? "VAT payable (output − input)" : "VAT refundable (input more than output)")}</div>
          </div>
        </div>
        <List title="VAT output (on sales)" rows={outLines} sign={1} />
        <List title="VAT input (on purchases)" rows={inLines} sign={-1} />
        <p className="small muted">
          {tr("The VAT return for a month is filed with TRA by the 20th of the next month. Reversals of cancelled documents show in brackets.")}
        </p>
      </section>
    </>
  );
}
