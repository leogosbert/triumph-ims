import { StepUpLink } from "@/components/ConfirmIdentity";
import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { requireManager } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { KEEP, KIND_LABEL, formatBytes, loadBackupStatus, type BackupRow, type BackupStatus } from "@/lib/backups";
import { backupNow } from "./actions";
import { SettingsHead } from "../SettingsHead";

export const metadata = { title: "Backups" };

const TZ = "Africa/Dar_es_Salaam";
const dayOf = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
const timeOf = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** The big line at the top: good news, or what to do. */
function Headline({ status }: { status: BackupStatus }) {
  if (status.is_demo) {
    return <p className="notice notice-ok">{tr("Demo companies are not backed up. Your real company's data is backed up every day.")}</p>;
  }
  if (status.overdue) {
    return (
      <div className="notice notice-error" role="alert">
        <span className="notice-icon" aria-hidden>
          !
        </span>
        <span>
          <strong>{tr("Automatic backup has not run for more than 2 days.")}</strong>{" "}
          {status.last_auto_at ? `${tr("Last automatic backup:")} ${formatDateTime(status.last_auto_at)}. ` : ""}
          {tr("Press \"Back up now\" below, and tell LeMo Tech support so we can fix it.")}
        </span>
      </div>
    );
  }
  if (!status.last_auto_at) {
    return <p className="notice notice-ok">{tr("Automatic backups are on. The first one is taken early tomorrow morning (after 2 am).")}</p>;
  }
  const today = dayOf(new Date());
  const yesterday = dayOf(new Date(Date.now() - 864e5));
  const d = dayOf(status.last_auto_at);
  const when =
    d === today
      ? `${tr("Your data was backed up automatically today at")} ${timeOf(status.last_auto_at)}`
      : d === yesterday
        ? `${tr("Your data was backed up automatically yesterday at")} ${timeOf(status.last_auto_at)}`
        : `${tr("Your data was last backed up automatically on")} ${formatDateTime(status.last_auto_at)}`;
  return (
    <p className="notice notice-ok" role="status">
      <span className="notice-icon" aria-hidden>
        ✓
      </span>
      <span>
        <strong>{when}</strong>
      </span>
    </p>
  );
}

export default async function BackupsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company } = await requireManager();
  const status = await loadBackupStatus(supabase, company.id);
  const { data } = status
    ? await supabase
        .from("company_backups")
        .select("id, kind, taken_at, tables, rows, bytes, checksum, warnings, created_by")
        .eq("company_id", company.id)
        .order("taken_at", { ascending: false })
        .limit(50)
    : { data: null };
  const backups = (data ?? []) as BackupRow[];
  const manualLeft = status ? Math.max(0, status.manual_limit - status.manual_today) : 0;

  return (
    <>
      <SettingsHead
        title={tr("Backups")}
        icon="inbox"
        lead={tr("A copy of all your company's records is taken every day. Download one any time to keep your own copy.")}
      />
      <Notice {...notice} />

      {!status ? (
        <section className="card">
          <p style={{ margin: 0 }}>{tr("Automatic backups are not switched on yet. Ask LeMo Tech to run the latest database update.")}</p>
        </section>
      ) : (
        <>
          <Headline status={status} />

          {!status.is_demo && (
            <section className="card" id="backup-now">
              <form action={backupNow}>
                <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Backing up…")}>
                  {tr("Back up now")}
                </SubmitButton>
              </form>
              <p className="small muted" style={{ marginBottom: 0 }}>
                {manualLeft > 0
                  ? `${tr("Use this before a big change, e.g. importing many records.")} ${tr("Left today:")} ${manualLeft}`
                  : tr("You have used today's 5 backups by hand. Automatic backups continue as normal.")}
              </p>
            </section>
          )}

          <section className="card" id="list">
            <div className="st-card-head">
              <h2>{tr("Your backups")}</h2>
              {backups.length > 0 && <span className="badge tone-off">{backups.length}</span>}
            </div>
            {backups.length === 0 ? (
              <p className="muted small" style={{ margin: 0 }}>{tr("No backups yet.")}</p>
            ) : (
              <ul className="list st-rows">
                {backups.map((b) => (
                  <li key={b.id} className="row">
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{formatDateTime(b.taken_at)}</strong>{" "}
                      <span className={`badge ${b.kind === "manual" ? "tone-info" : "tone-ok"}`}>{tr(KIND_LABEL[b.kind])}</span>
                      <div className="muted small">
                        {b.rows.toLocaleString("en-GB")} {tr("records")} · {formatBytes(b.bytes)}
                        {b.warnings.length > 0 && (
                          <span className="text-warn"> · {tr("Some records could not be copied")} ({b.warnings.length})</span>
                        )}
                      </div>
                    </div>
                    {/* No `download` attribute: the server sends the file as an attachment, and on a problem
                        (e.g. "sign in again") it returns to this page with a message instead of saving it. */}
                    <StepUpLink className="btn btn-small" href={`/settings/backups/download/${b.id}`}>
                      {tr("Download")}
                    </StepUpLink>
                  </li>
                ))}
              </ul>
            )}
            {backups.length > 0 && (
              <p className="small muted" style={{ marginBottom: 0 }}>
                {tr("Very large backups can take a while to download. If a download fails, contact LeMo Tech support.")}
              </p>
            )}
          </section>
        </>
      )}

      <section className="card" id="how">
        <h2>{tr("How backups work")}</h2>
        <div className="st-faq">
          <details open>
            <summary>{tr("What is backed up")}</summary>
            <p>
              {tr("Every record of")} {company.name}
              {tr(": company details, team and roles, clients, suppliers, products, prices and costs, RFQs, quotations, purchase orders, stock, deliveries, invoices, payments, bills and suggestions. Not included: the Activity log, notifications, and files such as logos, photos and signatures (they stay in file storage).")}
            </p>
          </details>
          <details>
            <summary>{tr("When and how long")}</summary>
            <p>
              {tr("A copy is taken automatically every day early in the morning (Tanzania time). We keep the last")} {KEEP.daily}{" "}
              {tr("daily copies, the last")} {KEEP.weekly} {tr("Sunday copies, the last")} {KEEP.monthly}{" "}
              {tr("copies from the 1st of each month, and the last")} {KEEP.manual} {tr("copies made by hand. Older copies are deleted automatically.")}
            </p>
          </details>
          <details>
            <summary>{tr("Who can see them")}</summary>
            <p>{tr("Only management. Every download is written to the Activity log.")}</p>
          </details>
          <details>
            <summary>{tr("Extra safety")}</summary>
            <p>{tr("LeMo Tech also keeps an encrypted copy of the whole system every night, stored in a separate place.")}</p>
          </details>
          <details>
            <summary>{tr("Tip: keep your own copy")}</summary>
            <p>
              {tr("Once a month, press Download on the newest backup and keep the file somewhere safe, e.g. a USB stick or your company email. Treat it like your bank statements: it contains your prices, clients and payments.")}
            </p>
          </details>
          <details>
            <summary>{tr("Restoring")}</summary>
            <p>
              {tr("To restore, contact LeMo Tech support with the date of the backup you need. We check it with you before anything is changed.")}{" "}
              <Link href="/settings/export">{tr("Export data")}</Link> {tr("gives you Excel (CSV) files of the same records.")}
            </p>
          </details>
        </div>
      </section>
    </>
  );
}
