import { primeLang, tr } from "@/lib/tr";
import { formatDate } from "@/lib/format";
import { platformAdmin } from "../guard";
import { RemoveFiles } from "./RemoveFiles";

export const metadata = { title: "Deletions" };

type Row = { label: string | null; requested_at: string; delete_after: string; status: "scheduled" | "cancelled" | "done"; done_at: string | null; stuck: boolean };
type Data = {
  counts: Record<"accounts_scheduled" | "accounts_done" | "accounts_cancelled" | "companies_scheduled" | "companies_done" | "companies_cancelled" | "file_folders_left", number>;
  accounts: Row[];
  companies: Row[];
};

const STATUS: Record<Row["status"], { label: string; tone: string }> = {
  scheduled: { label: "Scheduled", tone: "tone-warn" },
  cancelled: { label: "Cancelled", tone: "tone-off" },
  done: { label: "Deleted", tone: "tone-ok" },
};

function Table({ rows, first, empty }: { rows: Row[]; first: string; empty: string }) {
  if (rows.length === 0) return <p className="muted small">{tr(empty)}</p>;
  return (
    <div className="scroll-x">
      <table className="adm-table">
        <thead>
          <tr>
            <th>{tr(first)}</th>
            <th>{tr("Requested")}</th>
            <th>{tr("Delete after")}</th>
            <th>{tr("Status")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td>{r.label || <span className="muted">{tr("Closed company")}</span>}</td>
              <td>{formatDate(r.requested_at)}</td>
              <td>{formatDate(r.delete_after)}</td>
              <td>
                <span className={`badge ${STATUS[r.status].tone}`}>{tr(STATUS[r.status].label)}</span>
                {r.stuck && <span className="badge tone-bad adm-mini">{tr("Not finished: retrying")}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Account deletions and company closures (read-only). Minimal on purpose: dates, status, the
 * company name while it is closing, and only the first letter of a person's name.
 * Nobody here can cancel or speed up a deletion: people do that themselves in the app.
 */
export default async function AdminDeletionsPage() {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const [{ data, error }, files] = await Promise.all([
    admin.supabase.rpc("platform_deletions", { p_limit: 200 }),
    admin.supabase.rpc("platform_storage_cleanup"),
  ]);
  const d = error ? null : (data as Data);
  const folders = (files.data ?? []) as { id: string; bucket: string; prefix: string }[];

  return (
    <>
      {!d ? (
        <p className="notice notice-error">{tr("Deletions could not be loaded. Check that the latest database update has been run.")}</p>
      ) : (
        <>
          <div className="stat-grid adm-stats">
            <div className="stat">
              <div className="n">{d.counts.accounts_scheduled}</div>
              <div className="l">{tr("Accounts waiting to be deleted")}</div>
            </div>
            <div className="stat">
              <div className="n">{d.counts.accounts_done}</div>
              <div className="l">{tr("Accounts deleted")}</div>
            </div>
            <div className="stat">
              <div className="n">{d.counts.accounts_cancelled}</div>
              <div className="l">{tr("Accounts kept (cancelled)")}</div>
            </div>
            <div className="stat">
              <div className="n">{d.counts.companies_scheduled}</div>
              <div className="l">{tr("Companies closing")}</div>
            </div>
            <div className="stat">
              <div className="n">{d.counts.companies_done}</div>
              <div className="l">{tr("Companies closed")}</div>
            </div>
            <div className="stat">
              <div className="n">{d.counts.companies_cancelled}</div>
              <div className="l">{tr("Closures cancelled")}</div>
            </div>
          </div>

          {folders.length > 0 && (
            <section className="card">
              <h2>
                {tr("Files to remove:")} {folders.length} {tr("folders")}
              </h2>
              <p className="small muted">
                {tr("Logos, signatures and delivery photos of closed companies that the database could not delete by itself.")}
              </p>
              <RemoveFiles folders={folders} />
            </section>
          )}

          <section className="card">
            <h2>{tr("Company closures")}</h2>
            <Table rows={d.companies} first="Company" empty="No company closures." />
          </section>

          <section className="card">
            <h2>{tr("Account deletions")}</h2>
            <Table rows={d.accounts} first="Person" empty="No account deletions." />
          </section>

          <p className="small muted">
            {tr("Read-only. People cancel their own deletion (Keep my account) and managers cancel a closure in the app. After the date it cannot be undone; the only copy left is the encrypted nightly backup.")}
          </p>
        </>
      )}
    </>
  );
}
