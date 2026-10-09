import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { daysUntil, docKindLabel } from "@/lib/crm";
import { formatDate, formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { can } from "@/lib/roles";
import { archiveDocument, saveDocument } from "../actions";
import { DocumentFields } from "../DocumentFields";
import { FilePicker } from "../FilePicker";
import { loadLinkOptions } from "../links";

export const metadata = { title: "Document" };

function size(bytes: number | null) {
  if (!bytes) return "";
  return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeDocuments")) redirect("/");
  const { data: d } = await supabase.from("documents").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!d) notFound();
  const [links, names, signed] = await Promise.all([
    loadLinkOptions(supabase, company.id),
    namesFor(supabase, [d.created_by]),
    d.file_path ? supabase.storage.from("documents").createSignedUrl(d.file_path, 3600) : Promise.resolve({ data: null }),
  ]);
  const url = signed.data?.signedUrl ?? null;
  const isImage = typeof d.file_type === "string" && d.file_type.startsWith("image/");
  const left = daysUntil(d.expires_on);
  const linked: { href: string; label: string }[] = [];
  const add = (list: { id: string; name: string }[], v: string | null, base: string, label: string) => {
    if (!v) return;
    const o = list.find((x) => x.id === v);
    linked.push({ href: `${base}/${v}`, label: `${tr(label)}: ${o?.name ?? "…"}` });
  };
  add(links.products, d.product_id, "/products", "Product");
  add(links.suppliers, d.supplier_id, "/suppliers", "Supplier");
  add(links.clients, d.client_id, "/clients", "Client");
  add(links.tenders, d.tender_id, "/tenders", "Tender");
  add(links.contracts, d.contract_id, "/contracts", "Contract");

  return (
    <>
      <p className="small">
        <Link href="/documents">{tr("← Documents")}</Link>
      </p>
      <h1 style={d.archived_at ? { textDecoration: "line-through" } : undefined}>{d.title}</h1>
      <p className="muted small">
        {tr(docKindLabel(d.kind))}
        {d.reference && ` · ${d.reference}`}
        {d.issued_on && ` · ${tr("issued")} ${formatDate(d.issued_on)}`}
      </p>
      {d.expires_on && (
        <p className={left !== null && left <= d.remind_days ? "text-warn" : "small"}>
          {left !== null && left < 0 ? tr("Expired on") : tr("Expires on")} {formatDate(d.expires_on)}
          {left !== null && left >= 0 && ` · ${left} ${tr("days left")}`}
        </p>
      )}
      {linked.length > 0 && (
        <p className="small">
          {linked.map((l) => (
            <Link key={l.href} href={l.href} style={{ marginRight: 10 }}>
              {l.label}
            </Link>
          ))}
        </p>
      )}
      <Notice {...notice} />
      {d.archived_at && <div className="banner warn small">{tr("In the archive since")} {formatDateTime(d.archived_at)}</div>}

      <section className="card" id="file">
        <h2>{tr("File")}</h2>
        {url ? (
          <>
            {isImage && (
              <a href={url} target="_blank" rel="noreferrer">
                <img src={url} alt={d.title} style={{ maxWidth: "100%", maxHeight: 480, borderRadius: 8, display: "block", marginBottom: 8 }} />
              </a>
            )}
            <p>
              <a href={url} target="_blank" rel="noreferrer" className="btn btn-small btn-primary">
                {tr("Open / download")}
              </a>{" "}
              <span className="small muted">
                {d.file_name} {size(d.file_size)}
              </span>
            </p>
            <p className="small muted">{tr("The link works for one hour. To share the file, download it and send it on WhatsApp or by email.")}</p>
          </>
        ) : (
          <p className="muted small">{tr("No file yet.")}</p>
        )}
        {!d.archived_at && <FilePicker companyId={company.id} documentId={d.id} hasFile={!!d.file_path} />}
      </section>

      <details className="card" open={!d.file_path && !d.archived_at}>
        <summary>{tr("Edit details")}</summary>
        <form action={saveDocument} style={{ marginTop: 10 }}>
          <input type="hidden" name="id" value={d.id} />
          <fieldset className="plain" disabled={!!d.archived_at}>
            <DocumentFields v={d} links={links} />
            {!d.archived_at && <SubmitButton>{tr("Save")}</SubmitButton>}
          </fieldset>
        </form>
      </details>

      <form action={archiveDocument} className="actions">
        <input type="hidden" name="id" value={d.id} />
        <input type="hidden" name="archive" value={d.archived_at ? "0" : "1"} />
        <SubmitButton className="btn btn-small" pendingText="…">
          {d.archived_at ? tr("Restore from the archive") : tr("Move to the archive")}
        </SubmitButton>
      </form>
      <p className="small muted">
        {tr("Added by")} {names.get(d.created_by) ?? "—"} · {formatDateTime(d.created_at)}
      </p>
    </>
  );
}
