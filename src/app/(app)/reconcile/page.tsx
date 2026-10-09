import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, stage13Ready } from "@/lib/context";
import { methodLabel, MOBILE_MONEY, monthRange, n, PAY_METHODS } from "@/lib/finance";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { markChecked, matchStatement } from "./actions";
import { StatementBox } from "./StatementBox";

export const metadata = { title: "Check payments" };

type Line = {
  kind: "payment" | "supplier_payment" | "expense";
  id: string;
  number: string;
  date: string;
  amount: number;
  currency: string;
  rate: number;
  method: string;
  provider: string | null;
  reference: string | null;
  checked: boolean;
  who: string;
  href: string;
};

const norm = (s: string | null) => (s ?? "").replace(/\s+/g, "").toUpperCase();

export default async function ReconcilePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const m = monthRange(typeof sp.m === "string" ? sp.m : null);
  const method = typeof sp.method === "string" && (sp.method === "all" || sp.method in PAY_METHODS) ? sp.method : "mobile_money";
  const show = sp.show === "all" ? "all" : "open";
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "reconcile")) redirect("/");
  const base = company.base_currency;

  if (!stage13Ready(company)) {
    return (
      <>
        <h1>{tr("Check payments")}</h1>
        <p className="card muted">{tr("This is not available yet. Ask LeMo Tech to run the latest database update.")}</p>
      </>
    );
  }

  const last = new Date(Date.parse(`${m.next}T12:00:00Z`) - 86400000).toISOString().slice(0, 10);
  const cols = "id, number, amount, currency, exchange_rate, method, provider, reference, reconciled_at";
  let qIn = supabase
    .from("payments")
    .select(`${cols}, received_on, client:clients(name), invoice_id`)
    .eq("company_id", company.id)
    .is("voided_at", null)
    .gte("received_on", m.start)
    .lt("received_on", m.next);
  let qOut = supabase
    .from("supplier_payments")
    .select(`${cols}, paid_on, supplier:suppliers(name), bill_id`)
    .eq("company_id", company.id)
    .is("voided_at", null)
    .gte("paid_on", m.start)
    .lt("paid_on", m.next);
  let qEx = supabase
    .from("expenses")
    .select(`${cols}, spent_on, payee, description`)
    .eq("company_id", company.id)
    .is("voided_at", null)
    .gte("spent_on", m.start)
    .lt("spent_on", m.next);
  if (method !== "all") {
    qIn = qIn.eq("method", method);
    qOut = qOut.eq("method", method);
    qEx = qEx.eq("method", method);
  }
  const [pIn, pOut, ex] = await Promise.all([qIn.limit(3000), qOut.limit(3000), qEx.limit(3000)]);
  for (const r of [pIn, pOut, ex]) if (r.error) throw new Error(r.error.message);
  type Base = { id: string; number: string; amount: number; currency: string; exchange_rate: number; method: string; provider: string | null; reference: string | null; reconciled_at: string | null };
  const mk = (kind: Line["kind"], r: Base, date: string, who: string, href: string): Line => ({
    kind,
    id: r.id,
    number: r.number,
    date,
    amount: n(r.amount),
    currency: r.currency,
    rate: n(r.exchange_rate),
    method: r.method,
    provider: r.provider,
    reference: r.reference,
    checked: !!r.reconciled_at,
    who,
    href,
  });
  const ins = ((pIn.data ?? []) as unknown as (Base & { received_on: string; invoice_id: string; client: { name: string } | null })[]).map((r) =>
    mk("payment", r, r.received_on, r.client?.name ?? "", `/invoices/${r.invoice_id}#payments`),
  );
  const outs = [
    ...((pOut.data ?? []) as unknown as (Base & { paid_on: string; bill_id: string; supplier: { name: string } | null })[]).map((r) =>
      mk("supplier_payment", r, r.paid_on, r.supplier?.name ?? "", `/bills/${r.bill_id}#payments`),
    ),
    ...((ex.data ?? []) as unknown as (Base & { spent_on: string; payee: string | null; description: string })[]).map((r) =>
      mk("expense", r, r.spent_on, [r.description, r.payee].filter(Boolean).join(" · "), `/expenses/${r.id}`),
    ),
  ];
  const all = [...ins, ...outs];
  const refCount = new Map<string, number>();
  for (const l of all) if (norm(l.reference)) refCount.set(norm(l.reference), (refCount.get(norm(l.reference)) ?? 0) + 1);
  const dup = (l: Line) => (refCount.get(norm(l.reference)) ?? 0) > 1;

  // Totals by service (mobile money) or method, money in and out, in the base currency.
  const byService = new Map<string, { label: string; inn: number; out: number; open: number }>();
  for (const l of all) {
    const key = l.method === "mobile_money" ? `mm:${l.provider ?? "other"}` : l.method;
    const g = byService.get(key) ?? { label: methodLabel(l.method, l.provider ?? (l.method === "mobile_money" ? "other" : null)), inn: 0, out: 0, open: 0 };
    if (l.kind === "payment") g.inn += l.amount * l.rate;
    else g.out += l.amount * l.rate;
    if (!l.checked) g.open += 1;
    byService.set(key, g);
  }
  const unchecked = all.filter((l) => !l.checked).length;
  const noRef = all.filter((l) => !norm(l.reference)).length;
  const dups = all.filter(dup).length;
  const q = (o: Record<string, string>) => {
    const p = new URLSearchParams({ m: m.month, method, show, ...o });
    return `/reconcile?${p.toString()}`;
  };

  const List = ({ title, lines }: { title: string; lines: Line[] }) => {
    const shown = show === "all" ? lines : lines.filter((l) => !l.checked);
    return (
      <section className="card">
        <h2>
          {title} <span className="muted small">· {lines.filter((l) => !l.checked).length} {tr("to check")}</span>
        </h2>
        {shown.length === 0 ? (
          <p className="muted small">{lines.length ? tr("All checked.") : tr("Nothing recorded.")}</p>
        ) : (
          <ul className="list">
            {shown
              .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
              .map((l) => (
                <li key={`${l.kind}:${l.id}`} className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                  <label style={{ display: "flex", gap: 10, alignItems: "flex-start", flex: 1, cursor: "pointer" }}>
                    <input type="checkbox" name="pick" value={`${l.kind}:${l.id}`} style={{ marginTop: 3 }} />
                    <span>
                      <strong>{l.reference || <span className="text-warn">{tr("no transaction code")}</span>}</strong>
                      {dup(l) && <span className="badge tone-warn" style={{ marginLeft: 6 }}>{tr("same code twice")}</span>}
                      <span className="small muted" style={{ display: "block" }}>
                        {formatDate(l.date)} · {tr(methodLabel(l.method, l.provider))} · {l.who}
                      </span>
                    </span>
                  </label>
                  <span className="small" style={{ textAlign: "right" }}>
                    <Link href={l.href}>{formatMoney(l.amount, l.currency)}</Link>
                    <span className="muted" style={{ display: "block" }}>
                      {l.checked ? <span className="text-ok">✓ {tr("checked")}</span> : l.number}
                    </span>
                  </span>
                </li>
              ))}
          </ul>
        )}
      </section>
    );
  };

  return (
    <>
      <p className="small">
        <Link href="/finance">{tr("← Finance")}</Link>
      </p>
      <h1>{tr("Check payments")}</h1>
      <p className="muted small">{tr("Compare what was recorded with the M-Pesa, Mixx, Airtel Money or bank statement. Tick what you find, or paste the statement and the matching transaction codes are ticked for you.")}</p>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Month")}>
        <Link href={q({ m: m.prev })}>{tr("← Earlier")}</Link>
        <Link href={q({})} aria-current="page">
          {tr(m.label)}
        </Link>
        {!m.isCurrent && <Link href={q({ m: m.after })}>{tr("Later →")}</Link>}
      </nav>
      <nav className="tabs-row" aria-label={tr("Payment method")}>
        {[["mobile_money", "Mobile money"], ["bank_transfer", "Bank transfer"], ["cash", "Cash"], ["all", "All"]].map(([k, label]) => (
          <Link key={k} href={q({ method: k })} aria-current={method === k ? "page" : undefined}>
            {tr(label)}
          </Link>
        ))}
      </nav>

      <div className="stat-grid">
        <div className="stat">
          <div className={`n ${unchecked ? "text-warn" : ""}`}>{unchecked}</div>
          <div className="l">{tr("not checked yet")}</div>
        </div>
        <div className="stat">
          <div className="n">{all.length - unchecked}</div>
          <div className="l">{tr("checked")}</div>
        </div>
        {noRef > 0 && (
          <div className="stat">
            <div className="n text-warn">{noRef}</div>
            <div className="l">{tr("without a transaction code")}</div>
          </div>
        )}
        {dups > 0 && (
          <div className="stat">
            <div className="n text-warn">{dups}</div>
            <div className="l">{tr("with a code used twice")}</div>
          </div>
        )}
      </div>

      {byService.size > 0 && (
        <section className="card">
          <h2>{method === "mobile_money" ? tr("By service") : tr("By method")}</h2>
          <div className="scroll-x">
            <table className="compare">
              <thead>
                <tr>
                  <th></th>
                  <th>{tr("Money in")}</th>
                  <th>{tr("Money out")}</th>
                  <th>{tr("To check")}</th>
                </tr>
              </thead>
              <tbody>
                {[...byService.entries()].map(([k, g]) => (
                  <tr key={k}>
                    <td>{tr(g.label)}</td>
                    <td>{formatMoney(g.inn, base)}</td>
                    <td>{formatMoney(g.out, base)}</td>
                    <td className={g.open ? "text-warn" : undefined}>{g.open}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <details className="card" open={unchecked > 0}>
        <summary>
          <strong>{tr("Paste a statement")}</strong>
        </summary>
        <form action={matchStatement} style={{ marginTop: 10 }}>
          <input type="hidden" name="m" value={m.month} />
          <input type="hidden" name="method" value={method} />
          <input type="hidden" name="show" value={show} />
          <input type="hidden" name="from" value={m.start} />
          <input type="hidden" name="to" value={last} />
          <StatementBox />
          <p className="small muted">{tr("Only transaction codes of 6 characters or more are matched. Nothing in the statement is stored.")}</p>
          <SubmitButton pendingText={tr("Checking…")}>{tr("Find and tick")}</SubmitButton>
        </form>
      </details>

      <form action={markChecked}>
        <input type="hidden" name="m" value={m.month} />
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="show" value={show} />
        <nav className="tabs-row" aria-label={tr("Show")}>
          <Link href={q({ show: "open" })} aria-current={show === "open" ? "page" : undefined}>
            {tr("To check")}
          </Link>
          <Link href={q({ show: "all" })} aria-current={show === "all" ? "page" : undefined}>
            {tr("All")}
          </Link>
        </nav>
        <List title={tr("Money in (from clients)")} lines={ins} />
        <List title={tr("Money out (suppliers and expenses)")} lines={outs} />
        {all.length > 0 && (
          <div className="actions">
            <SubmitButton name="done" value="1" pendingText={tr("Saving…")}>
              {tr("Mark ticked as checked")}
            </SubmitButton>
            {show === "all" && (
              <SubmitButton name="done" value="0" className="btn" pendingText={tr("Saving…")}>
                {tr("Untick")}
              </SubmitButton>
            )}
          </div>
        )}
      </form>
      {method === "mobile_money" && (
        <p className="small muted">
          {tr("Services")}: {Object.values(MOBILE_MONEY).map((v) => tr(v)).join(", ")}.
        </p>
      )}
    </>
  );
}
