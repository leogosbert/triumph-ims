import Link from "next/link";
import { StepUpForm } from "@/components/ConfirmIdentity";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatBytes } from "@/lib/backups";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { primeLang, tr } from "@/lib/tr";
import { platformAdmin } from "../guard";
import { restoreBackup } from "./actions";

export const metadata = { title: "Backups" };

type Company = {
  id: string;
  name: string;
  last_auto_at: string | null;
  copies: number;
  bytes: number;
  failed_checks: number;
  last_check_at: string | null;
  last_error: string | null;
  last_attempt_at: string | null;
  overdue: boolean;
};
type Request = {
  id: string;
  company_id: string;
  company: string;
  backup_id: string | null;
  backup_taken_at: string;
  note: string | null;
  status: "requested" | "done" | "cancelled" | "failed";
  requested_at: string;
  handled_at: string | null;
  requested_by: string | null;
  result: { error?: string; added?: Record<string, number>; fixed?: Record<string, number> } | null;
};

const STATUS: Record<Request["status"], { label: string; tone: string }> = {
  requested: { label: "Waiting", tone: "tone-warn" },
  done: { label: "Restored", tone: "tone-ok" },
  cancelled: { label: "Cancelled", tone: "tone-off" },
  failed: { label: "Not done", tone: "tone-bad" },
};

/** Backup health of every company, and restore requests from managers. */
export default async function AdminBackupsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const notice = await readNotice(searchParams);
  const { data, error } = await admin.supabase.rpc("platform_backup_health");
  const d = error ? null : (data as { companies: Company[]; requests: Request[] });

  if (!d) {
    return <p className="notice notice-error">{tr("Backups could not be loaded. Check that the latest database update has been run.")}</p>;
  }
  const open = d.requests.filter((r) => r.status === "requested");
  const past = d.requests.filter((r) => r.status !== "requested");
  const overdue = d.companies.filter((c) => c.overdue).length;
  const failing = d.companies.filter((c) => c.failed_checks > 0 || c.last_error).length;
  const total = d.companies.reduce((n, c) => n + Number(c.bytes || 0), 0);

  return (
    <>
      <Notice {...notice} />
      <div className="stat-grid adm-stats">
        <div className="stat">
          <div className="n">{d.companies.length}</div>
          <div className="l">{tr("Companies backed up")}</div>
        </div>
        <div className="stat">
          <div className={`n${overdue ? " text-warn" : ""}`}>{overdue}</div>
          <div className="l">{tr("Overdue (no copy for 2 days)")}</div>
        </div>
        <div className="stat">
          <div className={`n${failing ? " text-warn" : ""}`}>{failing}</div>
          <div className="l">{tr("With a failed backup or check")}</div>
        </div>
        <div className="stat">
          <div className="n">{open.length}</div>
          <div className="l">{tr("Restore requests waiting")}</div>
        </div>
        <div className="stat">
          <div className="n">{formatBytes(total)}</div>
          <div className="l">{tr("Space used by all copies")}</div>
        </div>
      </div>

      {open.map((r) => (
        <section key={r.id} className="card">
          <h2>
            {tr("Restore requested:")} {r.company}
          </h2>
          <p className="small">
            {tr("Backup of")} <strong>{formatDateTime(r.backup_taken_at)}</strong> · {tr("asked by")} {r.requested_by ?? "?"}{" "}
            {tr("on")} {formatDateTime(r.requested_at)}
          </p>
          {r.note && <p className="small">“{r.note}”</p>}
          <p className="small muted">
            {tr("Call the company first to confirm. The restore takes a safety copy, then replaces the company's records with the backup's (team, settings and billing stay). If anything does not fit, nothing is changed.")}
          </p>
          <StepUpForm action={restoreBackup}>
            <input type="hidden" name="request_id" value={r.id} />
            <div className="field">
              <label htmlFor={`cn-${r.id}`}>
                {tr("Type the company name to confirm:")} <strong>{r.company}</strong>
              </label>
              <input id={`cn-${r.id}`} name="company_name" type="text" autoComplete="off" spellCheck={false} required />
            </div>
            <SubmitButton className="btn btn-danger-solid btn-block" pendingText={tr("Restoring…")}>
              {tr("Restore now")}
            </SubmitButton>
          </StepUpForm>
          <details className="small" style={{ marginTop: 10 }}>
            <summary>{tr("Very large company? Run it in the Supabase SQL editor instead")}</summary>
            <p className="bk-checksum">select public.restore_company_backup_sql(&apos;{r.id}&apos;);</p>
          </details>
        </section>
      ))}

      <section className="card">
        <h2>{tr("Every company")}</h2>
        <div className="scroll-x">
          <table className="adm-table">
            <thead>
              <tr>
                <th>{tr("Company")}</th>
                <th>{tr("Last automatic copy")}</th>
                <th>{tr("Copies")}</th>
                <th>{tr("Last good check")}</th>
                <th>{tr("Problems")}</th>
              </tr>
            </thead>
            <tbody>
              {d.companies.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/admin/companies/${c.id}`}>{c.name}</Link>
                  </td>
                  <td>
                    {c.last_auto_at ? formatDateTime(c.last_auto_at) : <span className="muted">{tr("None yet")}</span>}
                    {c.overdue && <span className="badge tone-bad adm-mini">{tr("Overdue")}</span>}
                  </td>
                  <td>
                    {c.copies} · {formatBytes(Number(c.bytes || 0))}
                  </td>
                  <td>{c.last_check_at ? formatDateTime(c.last_check_at) : <span className="muted">–</span>}</td>
                  <td>
                    {c.failed_checks > 0 && (
                      <span className="badge tone-bad adm-mini">
                        {c.failed_checks} {tr("failed checks")}
                      </span>
                    )}
                    {c.last_error && <div className="small text-warn">{c.last_error}</div>}
                    {!c.failed_checks && !c.last_error && <span className="muted">–</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {past.length > 0 && (
        <section className="card">
          <h2>{tr("Earlier restore requests")}</h2>
          <ul className="list">
            {past.map((r) => (
              <li key={r.id} className="row" style={{ display: "block" }}>
                <strong>{r.company}</strong> · {tr("backup of")} {formatDateTime(r.backup_taken_at)}{" "}
                <span className={`badge ${STATUS[r.status].tone}`}>{tr(STATUS[r.status].label)}</span>
                <div className="small muted">
                  {tr("Asked")} {formatDateTime(r.requested_at)}
                  {r.handled_at && ` · ${tr("handled")} ${formatDateTime(r.handled_at)}`}
                </div>
                {r.result?.error && <div className="small text-warn">{r.result.error}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="small muted">
        {tr("Copies are checked by the scheduled job: new copies first, and every copy again each week. The whole-system encrypted copy (GitHub, every night) is separate and covers the Activity log and files.")}
      </p>
    </>
  );
}
