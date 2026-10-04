import { tr } from "@/lib/tr";
import Link from "next/link";
import { AGING } from "@/lib/finance";
import { formatMoney } from "@/lib/money";

export type AgingRow = { id: string; name: string; href: string; buckets: number[]; note?: string | null };

/** Money owed, split by how late it is. Amounts are in the base currency. */
export function AgingTable({ rows, currency, partyLabel }: { rows: AgingRow[]; currency: string; partyLabel: string }) {
  const totals = AGING.map((_, i) => rows.reduce((s, r) => s + r.buckets[i], 0));
  const grand = totals.reduce((a, b) => a + b, 0);
  const short = (v: number) => (v ? formatMoney(v, currency).replace(`${currency} `, "") : "–");
  return (
    <>
      <div className="stat-grid">
        <div className="stat">
          <div className="n">{formatMoney(grand, currency)}</div>
          <div className="l">{tr("Total outstanding")}</div>
        </div>
        <div className={`stat ${grand - totals[0] > 0 ? "alert" : ""}`}>
          <div className="n">{formatMoney(grand - totals[0], currency)}</div>
          <div className="l">{tr("Overdue")}</div>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="card muted">{tr("Nothing outstanding.")}</p>
      ) : (
        <div className="card scroll-x">
          <table className="compare">
            <thead>
              <tr>
                <th>{partyLabel}</th>
                <th>{tr("Total")}</th>
                {AGING.map((a) => (
                  <th key={a}>{a}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = r.buckets.reduce((a, b) => a + b, 0);
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={r.href}>{r.name}</Link>
                      {r.note && <div className="small text-warn">{r.note}</div>}
                    </td>
                    <td>
                      <strong>{short(t)}</strong>
                    </td>
                    {r.buckets.map((v, i) => (
                      <td key={i} className={i >= 3 && v > 0 ? "text-warn" : v ? undefined : "none"}>
                        {short(v)}
                      </td>
                    ))}
                  </tr>
                );
              })}
              <tr className="total">
                <td>{tr("Total (")}{currency})</td>
                <td>{short(grand)}</td>
                {totals.map((v, i) => (
                  <td key={i}>{short(v)}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
