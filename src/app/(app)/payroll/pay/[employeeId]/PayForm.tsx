"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { formatMoney } from "@/lib/money";
import { EMPLOYEE_PAY_METHODS, estimatePay, type PayrollSettings } from "@/lib/payroll";
import { useTr } from "@/lib/tr-client";

export type PayValues = {
  basic_salary: number;
  housing_allowance: number;
  transport_allowance: number;
  other_allowance: number;
  monthly_deduction: number;
  deduction_label: string;
  nssf_member: boolean;
  paye_exempt: boolean;
  pays_overtime: boolean;
  pay_method: string;
  bank_name: string;
  bank_account: string;
  mobile_number: string;
};

const num = (s: string) => {
  const v = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(v) && v > 0 ? v : 0;
};

/** The pay details form with a live estimate of a normal month (the database works out the real payslip). */
export function PayForm({
  action,
  employeeId,
  initial,
  settings,
  sdlApplies,
  currency,
}: {
  action: (form: FormData) => Promise<void>;
  employeeId: string;
  initial: PayValues;
  settings: PayrollSettings;
  sdlApplies: boolean;
  currency: string;
}) {
  const t = useTr();
  const [amounts, setAmounts] = useState({
    basic_salary: String(initial.basic_salary || ""),
    housing_allowance: String(initial.housing_allowance || ""),
    transport_allowance: String(initial.transport_allowance || ""),
    other_allowance: String(initial.other_allowance || ""),
    monthly_deduction: String(initial.monthly_deduction || ""),
  });
  const [nssf, setNssf] = useState(initial.nssf_member);
  const [exempt, setExempt] = useState(initial.paye_exempt);
  const [method, setMethod] = useState(initial.pay_method);
  const money = (n: number) => formatMoney(n, currency);
  const est = estimatePay(
    {
      basic: num(amounts.basic_salary),
      allowances: num(amounts.housing_allowance) + num(amounts.transport_allowance) + num(amounts.other_allowance),
      deduction: num(amounts.monthly_deduction),
      nssf_member: nssf,
      paye_exempt: exempt,
    },
    settings,
    sdlApplies,
  );

  const moneyField = (key: keyof typeof amounts, label: string) => (
    <div className="field">
      <label htmlFor={key}>
        {t(label)} ({currency})
      </label>
      <input
        id={key}
        name={key}
        type="text"
        inputMode="decimal"
        value={amounts[key]}
        onChange={(e) => setAmounts((a) => ({ ...a, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <form action={action}>
      <input type="hidden" name="employee_id" value={employeeId} />
      <section className="card">
        <h2>{t("Salary and allowances")}</h2>
        <div className="grid grid-2">
          {moneyField("basic_salary", "Basic salary")}
          {moneyField("housing_allowance", "Housing allowance")}
          {moneyField("transport_allowance", "Transport allowance")}
          {moneyField("other_allowance", "Other allowance")}
          {moneyField("monthly_deduction", "Monthly deduction")}
          <div className="field">
            <label htmlFor="deduction_label">{t("What the deduction is for")}</label>
            <input id="deduction_label" name="deduction_label" type="text" maxLength={80} defaultValue={initial.deduction_label} placeholder={t("e.g. salary advance, loan")} />
          </div>
        </div>
      </section>

      <section className="card">
        <h2>{t("Tax and overtime")}</h2>
        <div className="field">
          <label>
            <input type="checkbox" name="nssf_member" checked={nssf} onChange={(e) => setNssf(e.target.checked)} /> {t("NSSF member")}
          </label>
        </div>
        <div className="field">
          <label>
            <input type="checkbox" name="paye_exempt" checked={exempt} onChange={(e) => setExempt(e.target.checked)} /> {t("Exempt from PAYE")}
          </label>
        </div>
        <div className="field">
          <label>
            <input type="checkbox" name="pays_overtime" defaultChecked={initial.pays_overtime} /> {t("Paid overtime (from approved timesheets)")}
          </label>
        </div>
      </section>

      <section className="card">
        <h2>{t("How they are paid")}</h2>
        <div className="field">
          <label htmlFor="pay_method">{t("Pay method")}</label>
          <select id="pay_method" name="pay_method" value={method} onChange={(e) => setMethod(e.target.value)}>
            {Object.entries(EMPLOYEE_PAY_METHODS).map(([k, v]) => (
              <option key={k} value={k}>
                {t(v)}
              </option>
            ))}
          </select>
        </div>
        {method === "bank_transfer" && (
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="bank_name">{t("Bank name")}</label>
              <input id="bank_name" name="bank_name" type="text" maxLength={80} defaultValue={initial.bank_name} placeholder={t("e.g. CRDB")} />
            </div>
            <div className="field">
              <label htmlFor="bank_account">{t("Account number")}</label>
              <input id="bank_account" name="bank_account" type="text" maxLength={60} defaultValue={initial.bank_account} />
            </div>
          </div>
        )}
        {method === "mobile_money" && (
          <div className="field">
            <label htmlFor="mobile_number">{t("Mobile money number")}</label>
            <input id="mobile_number" name="mobile_number" type="tel" maxLength={30} defaultValue={initial.mobile_number} placeholder="07XX XXX XXX" />
          </div>
        )}
      </section>

      <section className="card">
        <h2>{t("Monthly estimate")}</h2>
        <p className="muted small">{t("A normal month without overtime, bonus or unpaid leave. The pay run works out the real figures.")}</p>
        <ul className="lines">
          <li>
            <div className="line-head">
              <span>{t("Gross pay")}</span>
              <strong>{money(est.gross)}</strong>
            </div>
          </li>
          <li>
            <div className="line-head">
              <span>{t("NSSF (employee)")}</span>
              <span>−{money(est.nssf)}</span>
            </div>
          </li>
          <li>
            <div className="line-head">
              <span>
                {t("PAYE")} <span className="muted small">({t("taxable")} {money(est.taxable)})</span>
              </span>
              <span>−{money(est.paye)}</span>
            </div>
          </li>
          {est.deduction > 0 && (
            <li>
              <div className="line-head">
                <span>{t("Monthly deduction")}</span>
                <span>−{money(est.deduction)}</span>
              </div>
            </li>
          )}
          <li>
            <div className="line-head">
              <strong>{t("Net pay")}</strong>
              <strong style={est.net < 0 ? { color: "var(--err)" } : undefined}>{money(est.net)}</strong>
            </div>
          </li>
          <li>
            <div className="line-head muted small">
              <span>{t("Paid by the employer: NSSF, SDL and WCF")}</span>
              <span>{money(est.nssfEmployer + est.sdl + est.wcf)}</span>
            </div>
          </li>
        </ul>
      </section>

      <SubmitButton pendingText={t("Saving…")}>{t("Save pay details")}</SubmitButton>
    </form>
  );
}
