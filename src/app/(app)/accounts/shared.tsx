import { tr } from "@/lib/tr";
import Link from "next/link";
import { getAppContext, noAccess } from "@/lib/context";
import { PERIOD_PRESETS, type Period, type StGroup } from "@/lib/ledger";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { BackLink as SharedBackLink } from "@/components/BackLink";

/** The app context for an Accounts page: management and finance only. */
export async function ledgerContext() {
  const ctx = await getAppContext();
  if (!can(ctx.roles, "seeLedger")) noAccess();
  const closedUntil = (ctx.company as { books_closed_until?: string | null }).books_closed_until ?? null;
  return { ...ctx, closedUntil };
}

/**
 * "Debit" and "Credit" as accounting columns. The shared word list already uses "Credit" for a loan
 * (Mkopo), so these two are worded here: Debiti / Krediti.
 */
export function drCr(lang: "en" | "sw") {
  return lang === "sw" ? { dr: "Debiti", cr: "Krediti" } : { dr: "Debit", cr: "Credit" };
}

/** Amount without the currency code, negatives in brackets (the way statements are printed). */
export function amt(n: number, currency: string): string {
  if (Math.abs(n) < 0.005) return "–";
  const s = formatMoney(Math.abs(n), currency).replace(`${currency} `, "");
  return n < 0 ? `(${s})` : s;
}

/** The shared back link, pointing to Accounts unless told otherwise. */
export function BackLink({ href = "/accounts", label = "Accounts" }: { href?: string; label?: string }) {
  return <SharedBackLink href={href} label={label} />;
}

/** Preset period tabs plus a custom from/to form (GET, so the period stays in the address). */
export function PeriodPicker({ path, period, extra = {} }: { path: string; period: Period; extra?: Record<string, string> }) {
  const q = (o: Record<string, string>) => new URLSearchParams({ ...extra, ...o }).toString();
  return (
    <div className="no-print">
      <nav className="tabs-row" aria-label={tr("Period")}>
        {PERIOD_PRESETS.map((p) => (
          <Link key={p.key} href={`${path}?${q({ p: p.key })}`} aria-current={period.key === p.key ? "page" : undefined}>
            {tr(p.label)}
          </Link>
        ))}
      </nav>
      <details className="card" open={period.key === "custom"}>
        <summary>{tr("Choose dates")}</summary>
        <form method="get" action={path} className="grid grid-2" style={{ marginTop: 10 }}>
          {Object.entries(extra).map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <div className="field">
            <label htmlFor="from">{tr("From")}</label>
            <input id="from" name="from" type="date" required defaultValue={period.from} />
          </div>
          <div className="field">
            <label htmlFor="to">{tr("To")}</label>
            <input id="to" name="to" type="date" required defaultValue={period.to} />
          </div>
          <div>
            <button type="submit" className="btn btn-small">
              {tr("Show")}
            </button>
          </div>
        </form>
      </details>
    </div>
  );
}

/** One section of a statement: heading, an account per row (linked to its ledger) and a total. */
export function GroupRows({
  group,
  currency,
  compare,
  totalLabel,
  hideEmpty = false,
}: {
  group: StGroup;
  currency: string;
  compare?: boolean;
  totalLabel?: string;
  hideEmpty?: boolean;
}) {
  if (hideEmpty && group.lines.length === 0) return null;
  return (
    <>
      <tr>
        <th colSpan={compare ? 3 : 2} style={{ textAlign: "left", background: "var(--soft)" }}>
          {tr(group.label)}
        </th>
      </tr>
      {group.lines.length === 0 && (
        <tr>
          <td className="muted small">{tr("Nothing yet")}</td>
          <td className="num">–</td>
          {compare && <td className="num">–</td>}
        </tr>
      )}
      {group.lines.map((l) => (
        <tr key={l.id}>
          <td style={{ paddingLeft: 18 }}>
            <Link href={`/accounts/ledger/${l.id}`}>
              <span className="muted small">{l.code}</span> {l.name}
            </Link>
          </td>
          <td className="num">{amt(l.amount, currency)}</td>
          {compare && <td className="num muted">{amt(l.compare ?? 0, currency)}</td>}
        </tr>
      ))}
      <tr>
        <td>
          <strong>{tr(totalLabel ?? "Total")}</strong>
        </td>
        <td className="num">
          <strong>{amt(group.total, currency)}</strong>
        </td>
        {compare && (
          <td className="num muted">
            <strong>{amt(group.compareTotal ?? 0, currency)}</strong>
          </td>
        )}
      </tr>
    </>
  );
}

/** A bold result row (gross profit, net profit, totals). */
export function ResultRow({ label, value, compare, currency, double }: { label: string; value: number; compare?: number; currency: string; double?: boolean }) {
  const style = { borderTop: "2px solid var(--text)", ...(double ? { borderBottom: "3px double var(--text)" } : {}) };
  return (
    <tr>
      <td style={style}>
        <strong>{tr(label)}</strong>
      </td>
      <td className={`num${value < 0 ? " text-warn" : ""}`} style={style}>
        <strong>{amt(value, currency)}</strong>
      </td>
      {compare !== undefined && (
        <td className="num muted" style={style}>
          <strong>{amt(compare, currency)}</strong>
        </td>
      )}
    </tr>
  );
}
