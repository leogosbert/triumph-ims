import { tr } from "@/lib/tr";
import Link from "next/link";
import { daysUntil, docKindLabel } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Field = "product_id" | "supplier_id" | "client_id" | "tender_id" | "contract_id";
const PARAM: Record<Field, string> = { product_id: "product", supplier_id: "supplier", client_id: "client", tender_id: "tender", contract_id: "contract" };

/**
 * The library documents linked to a product, supplier, client, tender or contract, with expiry.
 * Shows nothing before the Stage 14 SQL or for people who cannot use the library (drivers).
 */
export async function LinkedDocuments({
  supabase,
  companyId,
  field,
  id,
  back,
  kind,
}: {
  supabase: Supabase;
  companyId: string;
  field: Field;
  id: string;
  back: string;
  kind?: string;
}) {
  const { data, error } = await supabase
    .from("documents")
    .select("id, title, kind, reference, expires_on, file_path")
    .eq("company_id", companyId)
    .eq(field, id)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return null;
  const docs = (data ?? []) as { id: string; title: string; kind: string; reference: string | null; expires_on: string | null; file_path: string | null }[];
  const add = `/documents/new?${PARAM[field]}=${id}${kind ? `&kind=${kind}` : ""}&back=${encodeURIComponent(back)}`;
  return (
    <section className="card" id="documents">
      <div className="page-head" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>{tr("Documents")}</h2>
        <Link href={add} className="btn btn-small">
          {tr("+ Document")}
        </Link>
      </div>
      {docs.length === 0 ? (
        <p className="muted small">{tr("No documents yet. Keep certificates, licences, SDS and signed papers here so they are found in seconds.")}</p>
      ) : (
        <ul className="list">
          {docs.map((d) => {
            const left = daysUntil(d.expires_on);
            return (
              <li key={d.id} className="row">
                <Link href={`/documents/${d.id}`}>
                  {d.file_path ? "📎 " : ""}
                  {d.title}
                </Link>
                <span className="small muted">
                  {tr(docKindLabel(d.kind))}
                  {d.expires_on && (
                    <span className={left !== null && left <= 30 ? " text-warn" : undefined}>
                      {" · "}
                      {left !== null && left < 0 ? tr("expired") : tr("expires")} {formatDate(d.expires_on)}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
