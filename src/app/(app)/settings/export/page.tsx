import Link from "next/link";
import { requireManager } from "@/lib/context";
import { EXPORT_TABLES } from "@/lib/exportData";

export const metadata = { title: "Export data" };

export default async function ExportPage() {
  await requireManager();
  return (
    <>
      <p className="small">
        <Link href="/settings">← Settings</Link>
      </p>
      <h1>Export your data</h1>
      <p className="muted small">
        Your data belongs to you. Download it any time, as a backup or to move to other software. CSV files open in Excel. The JSON
        file contains everything in one file. Signatures, photos and logos are not included (they stay in file storage).
      </p>
      <section className="card">
        <a className="btn btn-primary btn-block" href="/settings/export/all.json" download>
          Download everything (one JSON file)
        </a>
      </section>
      <section className="card">
        <h2>One table at a time (CSV for Excel)</h2>
        <ul className="list">
          {EXPORT_TABLES.map((t) => (
            <li key={t.table} className="row">
              <span>{t.label}</span>
              <a className="btn btn-small" href={`/settings/export/${t.table}.csv`} download>
                CSV
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
