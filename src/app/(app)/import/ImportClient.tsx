"use client";

import Link from "next/link";
import { useState } from "react";
import readXlsxFile, { readSheetNames } from "read-excel-file";
import {
  CLIENT_COLUMNS,
  mapSheet,
  PRODUCT_COLUMNS,
  SUPPLIER_COLUMNS,
  withContacts,
  type Cell,
  type Problem,
  type Record_,
} from "@/lib/importMap";
import { runImport, type ImportResult } from "./actions";

type Parsed = { suppliers: Record_[]; clients: Record_[]; products: Record_[]; problems: Problem[]; missing: string[] };

const SHEETS = [
  { name: "Suppliers", key: "suppliers", columns: SUPPLIER_COLUMNS, id: "code" },
  { name: "Clients", key: "clients", columns: CLIENT_COLUMNS, id: "code" },
  { name: "Products", key: "products", columns: PRODUCT_COLUMNS, id: "sku" },
] as const;

export function ImportClient() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [readError, setReadError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setFileName(file.name);
    setParsed(null);
    setResult(null);
    setReadError(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setReadError("Please choose an Excel file (.xlsx). In Google Sheets use File → Download → Microsoft Excel.");
      return;
    }
    setReading(true);
    try {
      const names = await readSheetNames(file);
      const out: Parsed = { suppliers: [], clients: [], products: [], problems: [], missing: [] };
      for (const s of SHEETS) {
        const actual = names.find((n) => n.trim().toLowerCase() === s.name.toLowerCase());
        if (!actual) {
          out.missing.push(s.name);
          continue;
        }
        const rows = (await readXlsxFile(file, { sheet: actual })) as unknown as Cell[][];
        const { records, problems } = mapSheet(s.name, rows, [...s.columns], s.id);
        out[s.key] = s.key === "clients" ? records.map(withContacts) : records;
        out.problems.push(...problems);
      }
      if (out.missing.length === SHEETS.length) {
        setReadError('This file has no "Clients", "Suppliers" or "Products" tabs. Please use the master data template.');
      } else {
        setParsed(out);
      }
    } catch {
      setReadError("The file could not be read. Make sure it is a normal .xlsx file and not password-protected.");
    } finally {
      setReading(false);
    }
  }

  async function onImport() {
    if (!parsed) return;
    setSaving(true);
    setResult(null);
    try {
      setResult(await runImport({ suppliers: parsed.suppliers, clients: parsed.clients, products: parsed.products }));
    } catch {
      setResult({ ok: false, error: "The connection dropped before the import finished. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  const total = parsed ? parsed.suppliers.length + parsed.clients.length + parsed.products.length : 0;

  return (
    <>
      <section className="card">
        <h2>1. Choose the file</h2>
        <label className="btn btn-primary" style={{ cursor: "pointer" }}>
          {reading ? "Reading…" : fileName ? "Choose a different file" : "Choose Excel file"}
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={onFile} />
        </label>
        {fileName && <p className="small muted" style={{ marginTop: 8 }}>{fileName}</p>}
        {readError && <p className="notice notice-error">{readError}</p>}
      </section>

      {parsed && (
        <section className="card">
          <h2>2. Check what was found</h2>
          <ul className="list">
            {SHEETS.map((s) => {
              const rows = parsed[s.key];
              return (
                <li key={s.key} className="row">
                  <div>
                    <strong>{s.name}</strong>
                    <div className="muted small">
                      {parsed.missing.includes(s.name)
                        ? "Tab not found in the file — skipped"
                        : rows.length === 0
                          ? "No rows filled in"
                          : rows
                              .slice(0, 3)
                              .map((r) => String(r.name))
                              .join(", ") + (rows.length > 3 ? ` and ${rows.length - 3} more` : "")}
                    </div>
                  </div>
                  <span className="badge">{rows.length}</span>
                </li>
              );
            })}
          </ul>

          {parsed.problems.length > 0 ? (
            <div className="notice notice-error" style={{ marginTop: 12 }}>
              <strong>
                Fix {parsed.problems.length} problem{parsed.problems.length > 1 ? "s" : ""} in the spreadsheet, then
                choose the file again:
              </strong>
              <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {parsed.problems.slice(0, 30).map((p, i) => (
                  <li key={i}>
                    {p.sheet}, row {p.row}: {p.message}
                  </li>
                ))}
                {parsed.problems.length > 30 && <li>…and {parsed.problems.length - 30} more.</li>}
              </ul>
            </div>
          ) : total === 0 ? (
            <p className="notice notice-error">No rows to import. The grey example rows are skipped automatically.</p>
          ) : (
            <>
              <p className="small muted" style={{ marginTop: 12 }}>
                Records whose ID or SKU already exists will be <strong>updated</strong>; new ones are{" "}
                <strong>added</strong>. Rows without an ID get one automatically. If anything fails, nothing is saved.
              </p>
              <button className="btn btn-primary btn-block" onClick={onImport} disabled={saving}>
                {saving ? "Importing…" : `3. Import ${total} record${total > 1 ? "s" : ""}`}
              </button>
            </>
          )}
        </section>
      )}

      {result && !result.ok && <p className="notice notice-error">{result.error}</p>}
      {result && result.ok && (
        <section className="card">
          <h2>Done</h2>
          <ul className="list">
            <li className="row">
              <Link href="/suppliers">Suppliers</Link>
              <span>
                {result.counts.suppliers_added} added · {result.counts.suppliers_updated} updated
              </span>
            </li>
            <li className="row">
              <Link href="/clients">Clients</Link>
              <span>
                {result.counts.clients_added} added · {result.counts.clients_updated} updated
              </span>
            </li>
            <li className="row">
              <Link href="/products">Products</Link>
              <span>
                {result.counts.products_added} added · {result.counts.products_updated} updated
              </span>
            </li>
          </ul>
          {result.unmatched.length > 0 && (
            <p className="notice notice-error small" style={{ marginTop: 12 }}>
              These &ldquo;Main supplier&rdquo; names didn&apos;t match any supplier, so those products have no main
              supplier yet: {result.unmatched.join(", ")}. Check the spelling against the Suppliers tab, or set it on
              each product.
            </p>
          )}
        </section>
      )}
    </>
  );
}
