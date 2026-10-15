import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { StepUpLink } from "@/components/ConfirmIdentity";
import { Notice } from "@/components/Notice";
import { requireManager } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { EXPORT_TABLES } from "@/lib/exportData";
import { SettingsHead } from "../SettingsHead";

export const metadata = { title: "Export data" };

export default async function ExportPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  await requireManager();
  return (
    <>
      <SettingsHead
        title={tr("Export your data")}
        icon="doc"
        lead={tr("Your data belongs to you. Download it any time, as a backup or to move to other software. CSV files open in Excel. The JSON file contains everything in one file. Signatures, photos and logos are not included (they stay in file storage).")}
      />
      <Notice {...notice} />
      <section className="card" id="all">
        <h2>{tr("Everything in one file")}</h2>
        <StepUpLink className="btn btn-primary btn-block" href="/settings/export/all.json">{tr("Download everything (one JSON file)")}</StepUpLink>
        <p className="small muted" style={{ marginBottom: 0 }}>{tr("For your security you may be asked for your password again before downloading.")}</p>
      </section>
      <section className="card" id="tables">
        <div className="st-card-head">
          <h2>{tr("One table at a time (CSV for Excel)")}</h2>
          <span className="badge tone-off">{EXPORT_TABLES.length}</span>
        </div>
        <ul className="list st-rows">
          {EXPORT_TABLES.map((t) => (
            <li key={t.table} className="row">
              <span style={{ flex: 1, minWidth: 0 }}>{tr(String(t.label ?? ""))}</span>
              <StepUpLink className="btn btn-small" href={`/settings/export/${t.table}.csv`}>
                {tr("Download CSV")}
              </StepUpLink>
            </li>
          ))}
        </ul>
      </section>
      <p className="small muted">
        {tr("Looking for the daily copies?")} <Link href="/settings/backups">{tr("Backups")}</Link>
      </p>
    </>
  );
}
