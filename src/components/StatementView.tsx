import { tr } from "@/lib/tr";
import Link from "next/link";
import { AGING } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import type { Statement } from "@/lib/statements";

/** The statement of account on screen: period and currency pickers, the ledger, and what is open by age. */
export function StatementView({ s, path, kind }: { s: Statement; path: string; kind: "client" | "supplier" }) {
  const short = (v: number) => formatMoney(v, s.currency).replace(`${s.currency} `, "");
  const q = `from=${s.from}&to=${s.to}&ccy=${s.currency}`;
  return (
    <>
      <form method="get" className="card grid grid-2">
        <div className="field">
          <label htmlFor="from">{tr("From")}</label>
          <input id="from" name="from" type="date" defaultValue={s.from} />
        </div>
        <div className="field">
          <label htmlFor="to">{tr("To")}</label>
          <input id="to" name="to" type="date" defaultValue={s.to} />
        </div>
        {s.currencies.length > 1 && (
          <div className="field">
            <label htmlFor="ccy">{tr("Currency")}</label>
            <select id="ccy" name="ccy" defaultValue={s.currency}>
              {s.currencies.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
        <div className="actions" style={{ alignSelf: "end" }}>
          <button type="submit" className="btn">
            {tr("Show")}
          </button>
          <a href={`${path}/pdf?${q}`} className="btn btn-primary" target="_blank" rel="noreferrer">
            {tr("PDF")}
          </a>
        </div>
      </form>

      <div className="stat-grid">
        <div className="stat">
          <div className="n">{formatMoney(s.opening, s.currency)}</div>
          <div className="l">
            {tr("Balance on")} {formatDate(s.from)}
          </div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(s.charged, s.currency)}</div>
          <div className="l">{kind === "client" ? tr("Invoiced") : tr("Billed")}</div>
        </div>
        <div className="stat">
          <div className="n">{formatMoney(s.paid, s.currency)}</div>
          <div className="l">{kind === "client" ? tr("Received") : tr("Paid")}</div>
        </div>
        <div className="stat">
          <div className={`n ${s.closing > 0 && s.aging.slice(1).some((v) => v > 0) ? "text-warn" : ""}`}>{formatMoney(s.closing, s.currency)}</div>
          <div className="l">
            {kind === "client" ? tr("Owed to us on") : tr("We owe on")} {formatDate(s.to)}
          </div>
        </div>
      </div>

      <section className="card">
        <div className="scroll-x">
          <table className="compare">
            <thead>
              <tr>
                <th>{tr("Date")}</th>
                <th>{tr("Document")}</th>
                <th>{tr("Details")}</th>
                <th>{kind === "client" ? tr("Invoiced") : tr("Billed")}</th>
                <th>{kind === "client" ? tr("Received") : tr("Paid")}</th>
                <th>{tr("Balance")}</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, i) => (
                <tr key={i}>
                  <td>{formatDate(r.date)}</td>
                  <td>{r.doc}</td>
                  <td className="small">{tr(r.detail)}</td>
                  <td>{r.debit ? short(r.debit) : ""}</td>
                  <td>{r.credit ? short(r.credit) : ""}</td>
                  <td>
                    <strong>{short(r.balance)}</strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {s.rows.length === 1 && <p className="muted small">{tr("Nothing in this period.")}</p>}
      </section>

      {s.aging.some((v) => v > 0) && (
        <section className="card">
          <h2>
            {tr("Still open on")} {formatDate(s.to)}
          </h2>
          <div className="totals" style={{ maxWidth: "none" }}>
            {AGING.map((label, i) =>
              s.aging[i] > 0 ? (
                <div className={`row ${i > 0 ? "text-warn" : ""}`} key={label}>
                  <span>{tr(label)}</span>
                  <span>{formatMoney(s.aging[i], s.currency)}</span>
                </div>
              ) : null,
            )}
          </div>
        </section>
      )}
      <p className="small muted">
        {kind === "client"
          ? tr("Issued invoices and payments received (voided payments and cancelled invoices are left out). Send the PDF to the client to agree balances.")
          : tr("Supplier bills and payments made (voided payments and cancelled bills are left out). Compare it with the supplier's own statement.")}{" "}
        <Link href="/statements">{tr("All statements")}</Link>
      </p>
    </>
  );
}
