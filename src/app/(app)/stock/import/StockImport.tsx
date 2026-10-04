"use client";

import { useTr } from "@/lib/tr-client";
import Link from "next/link";
import { useState } from "react";
import readXlsxFile, { readSheetNames } from "read-excel-file";
import { importOpeningStock, type StockRow } from "./actions";

type Cell = string | number | boolean | Date | null;

function text(v: Cell) {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** Accepts 2027-06-30, 30/06/2027 or an Excel date. */
function isoDate(v: Cell) {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = text(v);
  if (!s) return "";
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return s;
}

const find = (header: string[], ...names: string[]) => header.findIndex((h) => names.some((n) => h.startsWith(n)));

export function StockImport() {
  const tr = useTr();
  const [rows, setRows] = useState<StockRow[] | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setRows(null);
    setError(null);
    setDone(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setError("Please choose an Excel file (.xlsx).");
      return;
    }
    try {
      const names = await readSheetNames(file);
      const sheet = names.find((n) => n.trim().toLowerCase() === "opening stock") ?? names[0];
      const data = (await readXlsxFile(file, { sheet })) as unknown as Cell[][];
      const header = (data[0] ?? []).map((h) => text(h).toLowerCase());
      const col = {
        sku: find(header, "sku"),
        store: find(header, "store"),
        quantity: find(header, "quantity", "qty"),
        batch: find(header, "batch"),
        expiry: find(header, "expiry"),
      };
      if (col.sku < 0 || col.quantity < 0) {
        setError('The first row must have "SKU" and "Quantity" columns. Please use the template.');
        return;
      }
      const out: StockRow[] = data
        .slice(1)
        .filter((r) => r.some((c) => text(c) !== ""))
        .map((r) => ({
          sku: text(r[col.sku]),
          store: col.store >= 0 ? text(r[col.store]) : "",
          quantity: text(r[col.quantity]),
          batch_no: col.batch >= 0 ? text(r[col.batch]) : "",
          expiry_date: col.expiry >= 0 ? isoDate(r[col.expiry]) : "",
        }));
      if (out.length === 0) setError("No rows found under the headings.");
      else setRows(out);
    } catch {
      setError("The file could not be read. Make sure it is a normal .xlsx file.");
    }
  }

  async function onLoad() {
    if (!rows) return;
    setBusy(true);
    setError(null);
    try {
      const res = await importOpeningStock(rows);
      if (res.ok) {
        setDone(res.count);
        setRows(null);
      } else setError(res.error);
    } catch {
      setError("The connection dropped. Nothing was loaded; please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="field">
        <label htmlFor="file">{tr("Spreadsheet (.xlsx)")}</label>
        <input id="file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={onFile} />
        {fileName && <p className="hint">{fileName}</p>}
      </div>
      {error && (
        <div className="notice notice-error" role="alert">
          {error}
        </div>
      )}
      {rows && (
        <>
          <p>
            <strong>{rows.length}</strong>{" "}{tr("row")}{rows.length === 1 ? "" : "s"}{" "}{tr("ready,")}{" "}{rows.reduce((s, r) => s + (Number(r.quantity) || 0), 0).toLocaleString("en-GB")}{" "}{tr("units in total.")}</p>
          <ul className="list small">
            {rows.slice(0, 5).map((r, i) => (
              <li key={i}>
                {r.sku} · {r.store || tr("MAIN")} · {r.quantity}
                {r.batch_no && ` · batch ${r.batch_no}`}
                {r.expiry_date && ` · exp ${r.expiry_date}`}
              </li>
            ))}
            {rows.length > 5 && <li className="muted">{tr("…and")}{" "}{rows.length - 5}{" "}{tr("more")}</li>}
          </ul>
          <button type="button" className="btn btn-primary btn-block" onClick={onLoad} disabled={busy}>
            {busy ? tr("Loading…") : tr("Load opening stock")}
          </button>
        </>
      )}
      {done !== null && (
        <div className="notice notice-ok" role="status">{tr("Loaded")}{" "}{done}{" "}{tr("row")}{done === 1 ? "" : "s"}{" "}{tr("of opening stock.")}{" "}<Link href="/stock">{tr("See stock →")}</Link>
        </div>
      )}
    </div>
  );
}
