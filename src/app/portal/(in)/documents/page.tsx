import { tr } from "@/lib/tr";
import { formatDate } from "@/lib/format";
import { call, requirePortal } from "@/lib/portal/server";
import type { SharedDoc } from "@/lib/portal/types";
import { DOC_KINDS, EmptyState } from "../../ui";

export const metadata = { title: "Documents" };

const size = (n: number | null) => (n == null ? "" : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Documents our team chose to share with this client or supplier (certificates, datasheets, contracts). */
export default async function PortalDocuments() {
  const ctx = await requirePortal();
  const docs = await call<SharedDoc[]>(ctx, "portal_documents");
  return (
    <>
      <div className="page-head">
        <h1>{tr("Documents")}</h1>
      </div>
      <section className="card">
        {docs.length === 0 ? (
          <EmptyState text="No documents shared with you yet." />
        ) : (
          <ul className="list">
            {docs.map((d) => (
              <li key={d.id} className="portal-row">
                <span>
                  <strong>{d.title}</strong>
                  <br />
                  <span className="small muted">
                    {tr(DOC_KINDS[d.kind] ?? "Document")}
                    {d.reference ? ` · ${d.reference}` : ""}
                    {d.expires_on ? ` · ${tr("Valid until")} ${formatDate(d.expires_on)}` : ""}
                    {d.file_size ? ` · ${size(d.file_size)}` : ""}
                  </span>
                </span>
                <a className="btn btn-small" href={`/portal/download/document/${d.id}/file`} target="_blank" rel="noopener">
                  {tr("Open")}
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
