import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { readSettings, type PayrollSettings } from "@/lib/payroll";
import { can } from "@/lib/roles";
import { saveSettings } from "../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Payroll rates" };

const FIELDS: { key: Exclude<keyof PayrollSettings, "paye_bands">; label: string; unit: string; hint?: string }[] = [
  { key: "nssf_employee_pct", label: "NSSF from the employee", unit: "%" },
  { key: "nssf_employer_pct", label: "NSSF from the employer", unit: "%" },
  { key: "sdl_pct", label: "SDL (skills development levy)", unit: "%" },
  { key: "sdl_min_employees", label: "SDL applies from this many employees", unit: "" },
  { key: "wcf_pct", label: "WCF (workers compensation)", unit: "%" },
  { key: "overtime_after_hours", label: "Overtime after hours per week", unit: "h" },
  { key: "overtime_factor", label: "Overtime rate (times the hourly pay)", unit: "×" },
  { key: "monthly_hours", label: "Working hours in a month (for the hourly pay)", unit: "h" },
];

export default async function PayrollSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "runPayroll")) redirect("/payroll/my");
  const { data, error } = await supabase.from("payroll_settings").select("*").eq("company_id", company.id).maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Payroll rates" />;
  const s = readSettings(data as Record<string, unknown> | null);
  const updatedAt = (data as { updated_at?: string } | null)?.updated_at;
  const editor = role === "management";
  const bands = [...s.paye_bands].sort((a, b) => a.from - b.from);
  const rows = editor ? [...bands, ...Array.from({ length: Math.max(0, Math.min(12, bands.length + 2) - bands.length) }, () => null)] : bands;
  const base = company.base_currency;

  return (
    <>
      <BackLink href="/payroll" label="Payroll" />
      <div className="page-head">
        <h1>{tr("Payroll rates")}</h1>
      </div>
      <p className="banner warn small">
        {tr("These rates follow the Tanzania mainland rules from July 2022. Check them whenever the budget changes the law.")}
      </p>
      <p className="muted small">
        {data ? updatedAt && `${tr("Last changed")} ${formatDateTime(updatedAt)}` : tr("These are the standard rates. They are saved for your company the first time you run payroll or save them.")}
      </p>
      <Notice {...notice} />
      <form action={saveSettings}>
        <section className="card">
          <h2>{tr("PAYE bands (monthly)")}</h2>
          <p className="muted small">{tr("Each rate is charged on the part of taxable pay above its starting amount, up to the next band. Taxable pay is gross pay less the employee's NSSF.")}</p>
          {editor ? (
            <>
              {rows.map((b, i) => (
                <div className="grid grid-2" key={i}>
                  <div className="field">
                    <label htmlFor={`band_from_${i}`}>
                      {tr("From amount")} ({base})
                    </label>
                    <input id={`band_from_${i}`} name={`band_from_${i}`} type="text" inputMode="decimal" defaultValue={b ? String(b.from) : ""} />
                  </div>
                  <div className="field">
                    <label htmlFor={`band_rate_${i}`}>{tr("Rate %")}</label>
                    <input id={`band_rate_${i}`} name={`band_rate_${i}`} type="text" inputMode="decimal" defaultValue={b ? String(b.rate) : ""} />
                  </div>
                </div>
              ))}
              <p className="muted small">{tr("Leave a row empty to remove it. Empty rows are for new bands.")}</p>
            </>
          ) : (
            <ul className="lines">
              {bands.map((b, i) => (
                <li key={i}>
                  <div className="line-head">
                    <span>
                      {formatMoney(b.from, base)}
                      {bands[i + 1] ? ` – ${formatMoney(bands[i + 1].from, base)}` : ` ${tr("and above")}`}
                    </span>
                    <strong>{b.rate}%</strong>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>{tr("NSSF, SDL, WCF and overtime")}</h2>
          {editor ? (
            <div className="grid grid-2">
              {FIELDS.map((f) => (
                <div className="field" key={f.key}>
                  <label htmlFor={f.key}>
                    {tr(f.label)}
                    {f.unit && ` (${f.unit})`}
                  </label>
                  <input id={f.key} name={f.key} type="text" inputMode="decimal" defaultValue={String(s[f.key])} required />
                </div>
              ))}
            </div>
          ) : (
            <ul className="lines">
              {FIELDS.map((f) => (
                <li key={f.key}>
                  <div className="line-head">
                    <span>{tr(f.label)}</span>
                    <strong>
                      {s[f.key]}
                      {f.unit && ` ${f.unit}`}
                    </strong>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">{tr("Hourly pay is the basic salary divided by the working hours in a month. SDL is only charged when the company has at least the number of employees set here.")}</p>
        </section>
        {editor ? <SubmitButton>{tr("Save rates")}</SubmitButton> : <p className="muted small">{tr("Only management can change payroll rates.")}</p>}
      </form>
    </>
  );
}
