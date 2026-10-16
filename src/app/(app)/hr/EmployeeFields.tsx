import { tr } from "@/lib/tr";
import { EMPLOYMENT_TYPES, type Employee } from "@/lib/hr";

/** The employee form, shared by New employee and Change details. */
export function EmployeeFields({ e = {}, logins }: { e?: Partial<Employee>; logins: { id: string; name: string }[] }) {
  const text = (id: keyof Employee, label: string, max: number, extra: { type?: string; placeholder?: string; inputMode?: "numeric" | "decimal" | "tel" | "email" } = {}) => (
    <div className="field">
      <label htmlFor={id}>{tr(label)}</label>
      <input
        id={id}
        name={id}
        type={extra.type ?? "text"}
        maxLength={max}
        inputMode={extra.inputMode}
        placeholder={extra.placeholder ? tr(extra.placeholder) : undefined}
        defaultValue={(e[id] as string | null | undefined) ?? ""}
      />
    </div>
  );
  const date = (id: keyof Employee, label: string) => (
    <div className="field">
      <label htmlFor={id}>{tr(label)}</label>
      <input id={id} name={id} type="date" defaultValue={(e[id] as string | null | undefined) ?? ""} />
    </div>
  );
  return (
    <div className="grid grid-2">
      <div className="field">
        <label htmlFor="full_name">{tr("Full name")}</label>
        <input id="full_name" name="full_name" type="text" required minLength={2} maxLength={120} defaultValue={e.full_name ?? ""} />
      </div>
      <div className="field">
        <label htmlFor="user_id">{tr("LeMoSp login")}</label>
        <select id="user_id" name="user_id" defaultValue={e.user_id ?? ""}>
          <option value="">{tr("— No login —")}</option>
          {logins.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <p className="hint">{tr("Linked people can ask for leave and see their own file.")}</p>
      </div>
      <div className="field">
        <label htmlFor="employee_no">{tr("Employee no.")}</label>
        <input id="employee_no" name="employee_no" type="text" maxLength={30} defaultValue={e.employee_no ?? ""} placeholder={tr("Blank = automatic (EMP-001)")} />
      </div>
      {text("job_title", "Job title", 80, { placeholder: "e.g. Technician" })}
      {text("department", "Department", 80, { placeholder: "e.g. Workshop" })}
      <div className="field">
        <label htmlFor="employment_type">{tr("Employment type")}</label>
        <select id="employment_type" name="employment_type" defaultValue={e.employment_type ?? "permanent"}>
          {Object.entries(EMPLOYMENT_TYPES).map(([k, label]) => (
            <option key={k} value={k}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      {date("start_date", "Start date")}
      {date("probation_end", "Probation ends")}
      {date("contract_end", "Contract ends")}
      <div className="field">
        <label htmlFor="annual_leave_days">{tr("Annual leave days")}</label>
        <input id="annual_leave_days" name="annual_leave_days" type="text" inputMode="decimal" defaultValue={e.annual_leave_days ?? 28} />
      </div>
      {text("phone", "Phone", 40, { type: "tel", inputMode: "tel" })}
      {text("email", "Email", 120, { type: "email", inputMode: "email" })}
      {text("emergency_contact", "Emergency contact name", 120)}
      {text("emergency_phone", "Emergency contact phone", 40, { type: "tel", inputMode: "tel" })}
      {text("id_number", "NIDA number", 40)}
      {text("tin", "TIN", 40)}
      {text("nssf_no", "NSSF number", 40)}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" maxLength={2000} defaultValue={e.notes ?? ""} />
      </div>
    </div>
  );
}
