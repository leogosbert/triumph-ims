"use client";

import { useRef } from "react";
import { useTr } from "@/lib/tr-client";

/** The statement text box, with a button to load a CSV or text file exported from the bank or mobile-money service. */
export function StatementBox() {
  const tr = useTr();
  const area = useRef<HTMLTextAreaElement>(null);
  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !area.current) return;
    if (file.size > 2_000_000) return alert(tr("The file is too big. Use one month at a time."));
    area.current.value = await file.text();
  }
  return (
    <>
      <div className="field">
        <label htmlFor="statement">{tr("Statement")}</label>
        <textarea
          ref={area}
          id="statement"
          name="statement"
          rows={6}
          placeholder={tr("Paste the statement here: select all in the M-Pesa / bank statement and copy, or load a CSV file.")}
        />
      </div>
      <div className="field">
        <label htmlFor="statement_file">{tr("Or load a CSV / text file")}</label>
        <input id="statement_file" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} />
      </div>
    </>
  );
}
