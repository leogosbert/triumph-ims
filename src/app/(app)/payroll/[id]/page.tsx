import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { PAYROLL_STATUS, RUN_PAY_METHODS, monthLabel, plain, statutoryItems, type PayrollLine, type PayrollRun } from "@/lib/payroll";
import { can, hasRole } from "@/lib/roles";
import { StatusBadge, todayTz } from "@/lib/sales";
import { approveRun, cancelRun, payRun, payStatutory, refreshRun, removeLine, updateLine } from "../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Pay run" };

type Journal = { id: string; number: string; entry_date: string; memo: string | null; source_ref: string | null };

export default async function PayRunPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!can(roles, "runPayroll")) redirect("/payroll/my");
  const { data: runRow, error } = await supabase
    .from("payroll_runs")
    .select("id, number, period, status, pay_date, employees, gross, nssf_employee, paye, deductions, net, nssf_employer, sdl, wcf, approved_at, paid_at, paid_method")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Pay run" />;
  if (!runRow) notFound();
  const run = runRow as PayrollRun;
  const { data: lineData } = await supabase.from("payroll_lines").select("*").eq("run_id", id).order("employee_name");
  const lines = (lineData ?? []) as PayrollLine[];
  const base = company.base_currency;
  const money = (n: number) => formatMoney(n, base);
  const isDraft = run.status === "draft";
  const isManager = hasRole(roles, "management");
  const settled = run.status === "approved" || run.status === "paid";
  const canCancel = isDraft || (run.status === "approved" && isManager);
  const cost = Number(run.gross) + Number(run.nssf_employer) + Number(run.sdl) + Number(run.wcf);
  const today = todayTz();

  // Statutory payments recorded since this run was approved (they are not tied to one run in the books).
  let paidJournals: (Journal & { amount: number })[] = [];
  if (settled && run.approved_at) {
    const { data: jData, error: jError } = await supabase
      .from("gl_journals")
      .select("id, number, entry_date, memo, source_ref")
      .eq("company_id", company.id)
      .eq("source", "payroll_payment")
      .is("source_id", null)
      .is("reversed_by", null)
      .gte("created_at", run.approved_at)
      .order("created_at", { ascending: false })
      .limit(30);
    const journals = jError ? [] : ((jData ?? []) as Journal[]);
    if (journals.length) {
      const { data: lData } = await supabase.from("gl_lines").select("journal_id, debit").in("journal_id", journals.map((j) => j.id));
      const sums = new Map<string, number>();
      for (const l of (lData ?? []) as { journal_id: string; debit: number }[]) sums.set(l.journal_id, (sums.get(l.journal_id) ?? 0) + Number(l.debit ?? 0));
      paidJournals = journals.map((j) => ({ ...j, amount: sums.get(j.id) ?? 0 }));
    }
  }

  const tiles: [string, number][] = [
    ["Gross pay", run.gross],
    ["PAYE", run.paye],
    ["NSSF employee", run.nssf_employee],
    ["NSSF employer", run.nssf_employer],
    ["SDL", run.sdl],
    ["WCF", run.wcf],
    ["Other deductions", run.deductions],
    ["Net to pay", run.net],
    ["Total cost to the company", cost],
  ];

  return (
    <>
      <BackLink href="/payroll" label="Payroll" />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{monthLabel(run.period, tr)}</h1>
        <StatusBadge map={PAYROLL_STATUS} status={run.status} />
      </div>
      <p className="muted small">
        {run.number} · {run.employees} {run.employees === 1 ? tr("person") : tr("people")}
        {run.pay_date && ` · ${tr("pay date")} ${formatDate(run.pay_date)}`}
        {run.approved_at && ` · ${tr("approved")} ${formatDateTime(run.approved_at)}`}
        {run.paid_at && ` · ${tr("paid")} ${formatDateTime(run.paid_at)}${run.paid_method ? ` (${tr(RUN_PAY_METHODS[run.paid_method] ?? run.paid_method)})` : ""}`}
      </p>
      <Notice {...notice} />

      <div className="stat-grid">
        {tiles.map(([label, n]) => (
          <div className="stat" key={label}>
            <div className="n">{money(Number(n))}</div>
            <div className="l">{tr(label)}</div>
          </div>
        ))}
      </div>
      <p className="muted small">{tr("Total cost to the company is gross pay plus employer NSSF, SDL and WCF.")}</p>

      {isDraft && (
        <div className="card">
          <h2>{tr("Check and approve")}</h2>
          <p className="muted small">
            {tr("This pay run is a draft. Change overtime, bonuses, deductions or unpaid days below. When it is right, management approves it: it is posted to the accounts and each person sees their payslip.")}
          </p>
          <div className="actions-bar">
            <form action={refreshRun}>
              <input type="hidden" name="run_id" value={run.id} />
              <SubmitButton className="btn btn-small" pendingText={tr("Refreshing…")}>
                {tr("Refresh from pay details, leave and timesheets")}
              </SubmitButton>
            </form>
            {isManager && (
              <form action={approveRun}>
                <input type="hidden" name="run_id" value={run.id} />
                <SubmitButton className="btn btn-primary btn-small" pendingText={tr("Approving…")}>
                  {tr("Approve")}
                </SubmitButton>
              </form>
            )}
          </div>
          {!isManager && <p className="muted small">{tr("Management approves the pay run.")}</p>}
        </div>
      )}

      {run.status === "approved" && (
        <form action={payRun} className="card">
          <h2>{tr("Mark as paid")}</h2>
          <p className="muted small">{tr("When the salaries have gone out. Use the payment list below for the bank or mobile money.")}</p>
          <input type="hidden" name="run_id" value={run.id} />
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="paid_on">{tr("Date paid")}</label>
              <input id="paid_on" name="paid_on" type="date" defaultValue={today} max={today} />
            </div>
            <div className="field">
              <label htmlFor="method">{tr("Paid by")}</label>
              <select id="method" name="method" defaultValue="bank_transfer">
                {Object.entries(RUN_PAY_METHODS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {tr(v)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <SubmitButton>{tr("Mark as paid")}</SubmitButton>
        </form>
      )}

      <section className="card">
        <h2>{tr("Payslips")}</h2>
        {lines.length === 0 ? (
          <p className="muted small">{tr("Nobody is in this pay run. Refresh it after entering pay details.")}</p>
        ) : (
          <div className="scroll-x">
            <table className="compare rep-table">
              <thead>
                <tr>
                  <th>{tr("Name")}</th>
                  <th className="num">{tr("Basic")}</th>
                  <th className="num">{tr("Allowances")}</th>
                  <th className="num">{tr("Overtime")}</th>
                  <th className="num">{tr("Bonus")}</th>
                  <th className="num">{tr("Unpaid days")}</th>
                  <th className="num">{tr("Gross")}</th>
                  <th className="num">{tr("NSSF")}</th>
                  <th className="num">{tr("PAYE")}</th>
                  <th className="num">{tr("Deductions")}</th>
                  <th className="num">{tr("Net")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/payroll/slip/${l.id}`}>{l.employee_name}</Link>
                      {l.job_title && <div className="muted small">{l.job_title}</div>}
                    </td>
                    <td className="num">{money(l.basic)}</td>
                    <td className="num">{money(l.allowances)}</td>
                    <td className="num">
                      {money(l.overtime)}
                      {Number(l.overtime_hours) > 0 && <div className="muted small">{Number(l.overtime_hours)} h</div>}
                    </td>
                    <td className="num">{money(l.bonus)}</td>
                    <td className="num">
                      {Number(l.unpaid_days)}
                      {Number(l.unpaid_deduction) > 0 && <div className="muted small">−{money(l.unpaid_deduction)}</div>}
                    </td>
                    <td className="num">{money(l.gross)}</td>
                    <td className="num">{money(l.nssf_employee)}</td>
                    <td className="num">{money(l.paye)}</td>
                    <td className="num">{money(l.other_deductions)}</td>
                    <td className="num">
                      <strong style={Number(l.net) < 0 ? { color: "var(--err)" } : undefined}>{money(l.net)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>{tr("Total")}</td>
                  <td className="num">{money(lines.reduce((s, l) => s + Number(l.basic), 0))}</td>
                  <td className="num">{money(lines.reduce((s, l) => s + Number(l.allowances), 0))}</td>
                  <td className="num">{money(lines.reduce((s, l) => s + Number(l.overtime), 0))}</td>
                  <td className="num">{money(lines.reduce((s, l) => s + Number(l.bonus), 0))}</td>
                  <td className="num">{lines.reduce((s, l) => s + Number(l.unpaid_days), 0)}</td>
                  <td className="num">{money(run.gross)}</td>
                  <td className="num">{money(run.nssf_employee)}</td>
                  <td className="num">{money(run.paye)}</td>
                  <td className="num">{money(run.deductions)}</td>
                  <td className="num">{money(run.net)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {isDraft && lines.length > 0 && (
        <section className="card">
          <h2>{tr("Change a payslip")}</h2>
          <p className="muted small">{tr("Overtime hours are paid at the overtime rate. Unpaid days are working days of unpaid leave.")}</p>
          {lines.map((l) => (
            <details key={l.id}>
              <summary>
                {l.employee_name} · {money(l.net)}
              </summary>
              <form action={updateLine}>
                <input type="hidden" name="run_id" value={run.id} />
                <input type="hidden" name="line_id" value={l.id} />
                <div className="grid grid-2">
                  <div className="field">
                    <label htmlFor={`ot-${l.id}`}>{tr("Overtime hours")}</label>
                    <input id={`ot-${l.id}`} name="overtime_hours" type="text" inputMode="decimal" defaultValue={plain(l.overtime_hours)} />
                  </div>
                  <div className="field">
                    <label htmlFor={`bonus-${l.id}`}>
                      {tr("Bonus")} ({base})
                    </label>
                    <input id={`bonus-${l.id}`} name="bonus" type="text" inputMode="decimal" defaultValue={plain(l.bonus)} />
                  </div>
                  <div className="field">
                    <label htmlFor={`ded-${l.id}`}>
                      {tr("Other deductions")} ({base}){l.deduction_label && ` · ${l.deduction_label}`}
                    </label>
                    <input id={`ded-${l.id}`} name="other_deductions" type="text" inputMode="decimal" defaultValue={plain(l.other_deductions)} />
                  </div>
                  <div className="field">
                    <label htmlFor={`unpaid-${l.id}`}>{tr("Unpaid days")}</label>
                    <input id={`unpaid-${l.id}`} name="unpaid_days" type="text" inputMode="decimal" defaultValue={plain(l.unpaid_days)} />
                  </div>
                </div>
                <SubmitButton className="btn btn-primary btn-small">{tr("Save")}</SubmitButton>
              </form>
              <form action={removeLine} style={{ marginTop: 8 }}>
                <input type="hidden" name="run_id" value={run.id} />
                <input type="hidden" name="line_id" value={l.id} />
                <SubmitButton className="btn btn-small" pendingText={tr("Removing…")}>
                  {tr("Remove from this pay run")}
                </SubmitButton>
              </form>
            </details>
          ))}
        </section>
      )}

      {settled && (
        <section className="card" id="statutory">
          <h2>{tr("Statutory payments")}</h2>
          <p className="muted small">{tr("What to pay and file for this month. Record each payment once, when it has been made.")}</p>
          <ul className="lines">
            {statutoryItems(run).map((item) => (
              <li key={item.kind}>
                <div className="line-head">
                  <div>
                    <div className="desc">
                      {tr(item.label)} · {tr(item.to)}
                    </div>
                    <div className="muted small">
                      {tr("Due by")} {formatDate(item.due)}
                      {item.kind === "sdl" && ` · ${tr("with PAYE")}`}
                    </div>
                  </div>
                  <strong style={{ whiteSpace: "nowrap" }}>{money(item.amount)}</strong>
                </div>
                {item.amount > 0 && (
                  <details>
                    <summary className="small">{tr("Record the payment")}</summary>
                    <form action={payStatutory}>
                      <input type="hidden" name="run_id" value={run.id} />
                      <input type="hidden" name="kind" value={item.kind} />
                      <div className="grid grid-2">
                        <div className="field">
                          <label htmlFor={`amt-${item.kind}`}>
                            {tr("Amount")} ({base})
                          </label>
                          <input id={`amt-${item.kind}`} name="amount" type="text" inputMode="decimal" defaultValue={plain(item.amount)} required />
                        </div>
                        <div className="field">
                          <label htmlFor={`on-${item.kind}`}>{tr("Date paid")}</label>
                          <input id={`on-${item.kind}`} name="paid_on" type="date" defaultValue={today} max={today} />
                        </div>
                        <div className="field">
                          <label htmlFor={`m-${item.kind}`}>{tr("Paid by")}</label>
                          <select id={`m-${item.kind}`} name="method" defaultValue="bank_transfer">
                            {Object.entries(RUN_PAY_METHODS).map(([k, v]) => (
                              <option key={k} value={k}>
                                {tr(v)}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`ref-${item.kind}`}>{tr("Reference")}</label>
                          <input id={`ref-${item.kind}`} name="reference" type="text" maxLength={60} placeholder={tr("e.g. control number or receipt")} />
                        </div>
                      </div>
                      <SubmitButton className="btn btn-primary btn-small">{tr("Record payment")}</SubmitButton>
                    </form>
                  </details>
                )}
              </li>
            ))}
          </ul>
          {paidJournals.length > 0 && (
            <>
              <h3>{tr("Payments recorded since this run was approved")}</h3>
              <ul className="lines">
                {paidJournals.map((j) => (
                  <li key={j.id}>
                    <div className="line-head">
                      <div>
                        <div className="desc">{j.memo ?? j.number}</div>
                        <div className="muted small">
                          {j.number} · {formatDate(j.entry_date)}
                        </div>
                      </div>
                      <strong style={{ whiteSpace: "nowrap" }}>{money(j.amount)}</strong>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {lines.length > 0 && (
        <section className="card">
          <h2>{tr("Downloads")}</h2>
          <p className="muted small">{tr("Lists to open in Excel: for the bank or mobile money, and for the PAYE and NSSF returns.")}</p>
          <div className="actions-bar">
            <a className="btn btn-small" href={`/payroll/${run.id}/export/payments`}>
              {tr("Payment list")}
            </a>
            <a className="btn btn-small" href={`/payroll/${run.id}/export/paye`}>
              {tr("PAYE list")}
            </a>
            <a className="btn btn-small" href={`/payroll/${run.id}/export/nssf`}>
              {tr("NSSF list")}
            </a>
          </div>
        </section>
      )}

      {canCancel && (
        <form action={cancelRun} className="card">
          <h2>{tr("Cancel this pay run")}</h2>
          <p className="muted small">
            {run.status === "approved"
              ? tr("The journal posted to the accounts is reversed and payslips are hidden again.")
              : tr("The draft is set aside. You can create a new pay run for the month.")}
          </p>
          <input type="hidden" name="run_id" value={run.id} />
          <SubmitButton className="btn btn-small" pendingText={tr("Cancelling…")}>
            {tr("Cancel pay run")}
          </SubmitButton>
        </form>
      )}
    </>
  );
}
