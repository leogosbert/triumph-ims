import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { StepUpLink } from "@/components/ConfirmIdentity";
import { Notice } from "@/components/Notice";
import { requireManager } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { EXPORT_TABLES } from "@/lib/exportData";

export const metadata = { title: "Export data" };

export default async function ExportPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  await requireManager();
  return (
    <>
      <p className="small">
        <Link href="/settings">{tr("← Settings")}</Link>
      </p>
      <h1>{tr("Export your data")}</h1>
      <Notice {...notice} />
      <p className="muted small">{tr("Your data belongs to you. Download it any time, as a backup or to move to other software. CSV files open in Excel. The JSON file contains everything in one file. Signatures, photos and logos are not included (they stay in file storage).")}</p>
      <section className="card">
        <StepUpLink className="btn btn-primary btn-block" href="/settings/export/all.json">{tr("Download everything (one JSON file)")}</StepUpLink>
        <p className="small muted" style={{ marginBottom: 0 }}>{tr("For your security you may be asked for your password again before downloading.")}</p>
      </section>
      <section className="card">
        <h2>{tr("One table at a time (CSV for Excel)")}</h2>
        <ul className="list">
          {EXPORT_TABLES.map((t) => (
            <li key={t.table} className="row">
              <span>{tr(String(t.label ?? ""))}</span>
              <StepUpLink className="btn btn-small" href={`/settings/export/${t.table}.csv`}>{tr("CSV")}</StepUpLink>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
