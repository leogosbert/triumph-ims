import Link from "next/link";
import { aiReady } from "@/lib/ai/claude";
import { tr } from "@/lib/tr";
import { SubmitButton } from "@/components/SubmitButton";
import { daysUntil, docKindLabel } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import type { createClient } from "@/lib/supabase/server";
import { linkExistingDocument, unlinkDocument } from "./actions";
import { UploadDocument } from "./UploadDocument";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Doc = { id: string; title: string; kind: string; reference: string | null; expires_on: string | null; file_path: string | null; archived_at: string | null };

/** The library documents linked to a checklist item or a licence: list, upload a new one, link an existing one. */
export async function LinkedFiles({
  supabase,
  companyId,
  itemId,
  licenceId,
  canEdit,
  back,
  defaultTitle,
  defaultKind,
  defaultExpiry,
  defaultReference,
}: {
  supabase: Supabase;
  companyId: string;
  itemId?: string;
  licenceId?: string;
  canEdit: boolean;
  back: string;
  defaultTitle: string;
  defaultKind: string;
  defaultExpiry?: string | null;
  defaultReference?: string | null;
}) {
  let q = supabase
    .from("compliance_documents")
    .select("id, document:documents(id, title, kind, reference, expires_on, file_path, archived_at)")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(100);
  q = itemId ? q.eq("item_id", itemId) : q.eq("licence_id", licenceId ?? "");
  const [{ data, error }, library] = await Promise.all([
    q,
    canEdit
      ? supabase.from("documents").select("id, title, kind").eq("company_id", companyId).is("archived_at", null).order("title").limit(1000)
      : Promise.resolve({ data: [] as { id: string; title: string; kind: string }[] }),
  ]);
  if (error) return null;
  const links = ((data ?? []) as unknown as { id: string; document: Doc | null }[]).filter((l) => l.document);
  const linked = new Set(links.map((l) => l.document!.id));
  const others = ((library.data ?? []) as { id: string; title: string; kind: string }[]).filter((d) => !linked.has(d.id));

  return (
    <section className="card" id="documents">
      <h2>{tr("Documents")}</h2>
      {links.length === 0 ? (
        <p className="muted small">{tr("No document yet. Upload the certificate, receipt or filed copy so it is ready for an audit or inspection.")}</p>
      ) : (
        <ul className="lines">
          {links.map((l) => {
            const d = l.document!;
            const left = daysUntil(d.expires_on);
            return (
              <li key={l.id}>
                <div className="line-head" style={{ alignItems: "center" }}>
                  <div>
                    <Link href={`/documents/${d.id}`}>
                      {d.file_path ? "📎 " : ""}
                      {d.title}
                    </Link>
                    <div className="small muted">
                      {tr(docKindLabel(d.kind))}
                      {d.reference && ` · ${d.reference}`}
                      {d.expires_on && (
                        <span className={left !== null && left <= 30 ? " text-warn" : undefined}>
                          {" · "}
                          {left !== null && left < 0 ? tr("expired") : tr("expires")} {formatDate(d.expires_on)}
                        </span>
                      )}
                      {d.archived_at && ` · ${tr("archived")}`}
                      {!d.file_path && ` · ${tr("no file yet")}`}
                    </div>
                  </div>
                  {canEdit && (
                    <form action={unlinkDocument}>
                      <input type="hidden" name="link_id" value={l.id} />
                      <input type="hidden" name="back" value={back} />
                      <SubmitButton className="btn btn-small" pendingText="…">
                        {tr("Unlink")}
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
          <UploadDocument
            companyId={companyId}
            itemId={itemId}
            licenceId={licenceId}
            defaultTitle={defaultTitle}
            defaultKind={defaultKind}
            defaultExpiry={defaultExpiry}
            defaultReference={defaultReference}
            aiOn={aiReady()}
            isManager={canEdit}
          />
          {others.length > 0 && (
            <form action={linkExistingDocument} className="inline-form" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {itemId && <input type="hidden" name="item_id" value={itemId} />}
              {licenceId && <input type="hidden" name="licence_id" value={licenceId} />}
              <input type="hidden" name="back" value={back} />
              <select name="document_id" aria-label={tr("A document already in the library")} required defaultValue="" style={{ flex: "1 1 200px", minWidth: 0 }}>
                <option value="" disabled>
                  {tr("Link a document already in the library…")}
                </option>
                {others.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </select>
              <SubmitButton className="btn btn-small">{tr("Link")}</SubmitButton>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
