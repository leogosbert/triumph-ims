import { StepUpForm, StepUpLink } from "@/components/ConfirmIdentity";
import { primeLang, tr } from "@/lib/tr";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { requireManager } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { KIND_LABEL, areaName, formatBytes, type BackupRow, type PreviewLine, type RestoreRequest } from "@/lib/backups";
import { requestRestore } from "../actions";
import { SettingsHead } from "../../SettingsHead";

export const metadata = { title: "Backup" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Settings → Backups → one backup: what is in it compared with today, and asking for a restore. */
export default async function BackupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const notice = await readNotice(searchParams);
  const { supabase, company } = await requireManager();

  const { data: row } = await supabase
    .from("company_backups")
    .select("id, kind, taken_at, tables, rows, bytes, checksum, warnings, created_by, verified_at, verify_ok, verify_note, note")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!row) notFound();
  const b = row as BackupRow;

  const [{ data: pv }, { data: open }] = await Promise.all([
    supabase.rpc("backup_restore_preview", { p_backup: id }),
    supabase.from("backup_restore_requests").select("id, backup_id, backup_taken_at, status").eq("company_id", company.id).eq("status", "requested").maybeSingle(),
  ]);
  const lines = ((pv as { tables?: PreviewLine[] } | null)?.tables ?? []).filter((l) => l.in_backup > 0 || (l.now ?? 0) > 0);
  const openReq = open as Pick<RestoreRequest, "id" | "backup_id" | "backup_taken_at"> | null;
  const isSafety = !!b.note?.startsWith("Safety copy");

  return (
    <>
      <SettingsHead
        title={`${tr("Backup of")} ${formatDateTime(b.taken_at)}`}
        icon="inbox"
        back={{ href: "/settings/backups", label: tr("← Backups") }}
      />
      <Notice {...notice} />

      <section className="card">
        <p style={{ marginTop: 0 }}>
          <span className={`badge ${b.kind === "manual" ? "tone-info" : "tone-ok"}`}>{tr(KIND_LABEL[b.kind])}</span>{" "}
          {b.verify_ok === true && <span className="badge tone-ok">✓ {tr("Checked")}</span>}
          {b.verify_ok === false && <span className="badge tone-bad">{tr("Check failed")}</span>}
          {b.verify_ok == null && <span className="badge tone-off">{tr("Not checked yet")}</span>}
        </p>
        {isSafety && <p className="small">{tr("Safety copy taken before a restore. Restore it to undo that restore.")}</p>}
        <p className="small muted">
          {b.rows.toLocaleString("en-GB")} {tr("records")} · {formatBytes(b.bytes)}
          {b.verified_at && (
            <>
              {" "}
              · {tr("Last checked")} {formatDateTime(b.verified_at)}
            </>
          )}
        </p>
        {b.verify_ok === false && (
          <p className="notice notice-error" role="alert">
            {tr("This backup failed its check, so it cannot be restored. Your other backups are not affected. LeMo Tech has been told.")}
          </p>
        )}
        {b.warnings.length > 0 && (
          <p className="small text-warn">
            {tr("Some records could not be copied")}: {b.warnings.join("; ")}
          </p>
        )}
        <p className="small muted" style={{ marginBottom: 6 }}>
          {tr("Fingerprint (SHA-256): matches the downloaded file exactly.")}
        </p>
        <p className="bk-checksum muted">{b.checksum}</p>
        <StepUpLink className="btn" href={`/settings/backups/download/${b.id}`}>
          {tr("Download")}
        </StepUpLink>
      </section>

      <section className="card">
        <h2>{tr("What is in this backup")}</h2>
        {lines.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>{tr("The comparison could not be loaded.")}</p>
        ) : (
          <div className="scroll-x">
            <table className="bk-preview" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>{tr("Area")}</th>
                  <th className="num">{tr("In this backup")}</th>
                  <th className="num">{tr("Now")}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.table} className={l.kept ? "kept" : undefined}>
                    <td>
                      {tr(areaName(l.table))}
                      {l.kept && <span className="small"> ({tr("stays as now")})</span>}
                    </td>
                    <td className="num">{l.in_backup.toLocaleString("en-GB")}</td>
                    <td className={`num${!l.kept && l.now != null && l.now !== l.in_backup ? " more" : ""}`}>
                      {l.now == null ? "–" : l.now.toLocaleString("en-GB")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          {tr("Numbers in red are different today: a restore brings them back to the backup.")}
        </p>
      </section>

      <section className="card" id="restore">
        <h2>{tr("Restore this backup")}</h2>
        <ul className="small">
          <li>{tr("Everything recorded after this backup (new clients, quotations, invoices, payments, stock…) is replaced by the records in the backup.")}</li>
          <li>{tr("Your team, company settings and LeMoSp billing stay as they are now. Document numbers never go backwards.")}</li>
          <li>{tr("A safety copy of today's data is taken first, so the restore can be undone.")}</li>
          <li>{tr("LeMo Tech checks with you before anything is changed.")}</li>
        </ul>
        {b.verify_ok === false ? null : openReq ? (
          <p className="notice notice-warn" style={{ marginBottom: 0 }}>
            {openReq.backup_id === b.id
              ? tr("A restore of this backup is already requested.")
              : `${tr("A restore of another backup is already requested")} (${formatDateTime(openReq.backup_taken_at)}). ${tr("Cancel it on the Backups page first.")}`}
          </p>
        ) : (
          <StepUpForm action={requestRestore}>
            <input type="hidden" name="backup_id" value={b.id} />
            <div className="field">
              <label htmlFor="note">{tr("What happened? (optional)")}</label>
              <textarea id="note" name="note" rows={2} maxLength={500} placeholder={tr("e.g. We deleted invoices by mistake")} />
            </div>
            <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Please wait…")}>
              {tr("Ask LeMo Tech to restore this backup")}
            </SubmitButton>
            <p className="small muted" style={{ marginBottom: 0 }}>{tr("You will be asked for your password first.")}</p>
          </StepUpForm>
        )}
      </section>
    </>
  );
}
