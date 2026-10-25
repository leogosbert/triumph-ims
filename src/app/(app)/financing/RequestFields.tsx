import { tr } from "@/lib/tr";
import Link from "next/link";
import { FACILITY_LABEL } from "@/lib/growth-tools/financing";

export type RequestStart = {
  bank_name?: string | null;
  bank_branch?: string | null;
  bank_contact?: string | null;
  facility?: string | null;
  amount?: number | string | null;
  tenor_days?: number | null;
  interest_rate?: number | string | null;
  lpo_number?: string | null;
  lpo_date?: string | null;
  lpo_amount?: number | string | null;
  lpo_document_id?: string | null;
  purpose?: string | null;
  repayment_source?: string | null;
  remind_days?: number | null;
  notes?: string | null;
};

/** The request form (new and edit). `docs`: the client's papers in the documents library. */
export function RequestFields({
  start,
  currency,
  docs,
  uploadHref,
  amountHint,
  edit,
}: {
  start: RequestStart;
  currency: string;
  docs: { id: string; title: string; kind: string }[];
  uploadHref: string;
  amountHint?: string | null;
  edit?: boolean;
}) {
  const v = (x: unknown) => (x === null || x === undefined ? "" : String(x));
  return (
    <>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="bank_name">{tr("Bank")}</label>
        <input id="bank_name" name="bank_name" type="text" required minLength={2} maxLength={120} defaultValue={v(start.bank_name)} placeholder={tr("e.g. CRDB Bank, NMB Bank, Stanbic Bank")} />
      </div>
      <div className="field">
        <label htmlFor="bank_branch">{tr("Branch")}</label>
        <input id="bank_branch" name="bank_branch" type="text" maxLength={120} defaultValue={v(start.bank_branch)} />
      </div>
      <div className="field">
        <label htmlFor="bank_contact">{tr("Relationship manager")}</label>
        <input id="bank_contact" name="bank_contact" type="text" maxLength={200} defaultValue={v(start.bank_contact)} placeholder={tr("Name, phone or email")} />
      </div>
      <div className="field">
        <label htmlFor="facility">{tr("Kind of financing")}</label>
        <select id="facility" name="facility" defaultValue={v(start.facility) || "lpo_finance"}>
          {Object.entries(FACILITY_LABEL).map(([k, label]) => (
            <option key={k} value={k}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="amount">
          {tr("Amount to borrow")} ({currency})
        </label>
        <input id="amount" name="amount" type="text" inputMode="decimal" defaultValue={v(start.amount)} required={edit} placeholder={amountHint ?? ""} />
        {amountHint && !edit && <span className="hint">{tr("Empty: the cost of the goods")} ({amountHint})</span>}
      </div>
      <div className="field">
        <label htmlFor="tenor_days">{tr("Tenor (days)")}</label>
        <input id="tenor_days" name="tenor_days" type="number" min={7} max={365} defaultValue={start.tenor_days ?? 90} />
      </div>
      <div className="field">
        <label htmlFor="interest_rate">
          {tr("Interest rate (% a year)")} <span className="hint">{tr("optional")}</span>
        </label>
        <input id="interest_rate" name="interest_rate" type="text" inputMode="decimal" defaultValue={v(start.interest_rate)} />
      </div>
      <div className="field">
        <label htmlFor="lpo_number">{tr("LPO number")}</label>
        <input id="lpo_number" name="lpo_number" type="text" maxLength={120} defaultValue={v(start.lpo_number)} />
      </div>
      <div className="field">
        <label htmlFor="lpo_date">{tr("LPO date")}</label>
        <input id="lpo_date" name="lpo_date" type="date" defaultValue={v(start.lpo_date)} />
      </div>
      <div className="field">
        <label htmlFor="lpo_amount">
          {tr("LPO value")} ({currency})
        </label>
        <input id="lpo_amount" name="lpo_amount" type="text" inputMode="decimal" defaultValue={v(start.lpo_amount)} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="lpo_document_id">{tr("Copy of the LPO")}</label>
        <select id="lpo_document_id" name="lpo_document_id" defaultValue={v(start.lpo_document_id)}>
          <option value="">{tr("Not attached yet")}</option>
          {docs.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
        <span className="hint">
          <Link href={uploadHref}>{tr("Upload the LPO to the documents library")}</Link>
        </span>
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="purpose">{tr("Purpose")}</label>
        <textarea id="purpose" name="purpose" rows={2} maxLength={1000} defaultValue={v(start.purpose)} placeholder={tr("Empty: to pay our suppliers for the goods on this order")} />
      </div>
      {edit && (
        <div className="field" style={{ gridColumn: "1 / -1" }}>
          <label htmlFor="repayment_source">{tr("Repaid from")}</label>
          <input id="repayment_source" name="repayment_source" type="text" maxLength={300} defaultValue={v(start.repayment_source)} />
        </div>
      )}
      <div className="field">
        <label htmlFor="remind_days">{tr("Remind before repayment (days)")}</label>
        <input id="remind_days" name="remind_days" type="number" min={0} max={60} defaultValue={start.remind_days ?? 7} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="notes">{tr("Notes")}</label>
        <textarea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={v(start.notes)} />
      </div>
    </>
  );
}
