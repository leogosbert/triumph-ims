import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { DOC_KINDS, daysUntil, docKindLabel, isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";

export const metadata = { title: "Documents" };

type Row = {
  id: string;
  title: string;
  kind: string;
  reference: string | null;
  expires_on: string | null;
  remind_days: number;
  file_path: string | null;
  archived_at: string | null;
  product: { name: string } | null;
  supplier: { name: string } | null;
  client: { name: string } | null;
  tender: { number: string } | null;
  contract: { number: string } | null;
};

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeDocuments")) redirect("/");
  const view = sp.view === "expiring" || sp.view === "archive" ? sp.view : "all";
  const kind = typeof sp.kind === "string" ? sp.kind : "";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";

  let query = supabase
    .from("documents")
    .select(
      "id, title, kind, reference, expires_on, remind_days, file_path, archived_at, product:products(name), supplier:suppliers(name), client:clients(name), tender:tenders(number), contract:contracts(number)",
    )
    .eq("company_id", company.id)
    .order("title")
    .limit(3000);
  query = view === "archive" ? query.not("archived_at", "is", null) : query.is("archived_at", null);
  if (kind) query = query.eq("kind", kind);
  const { data, error } = await query;
  if (isMissingTable(error)) return <NotReady title="Documents" />;
  if (error) throw new Error(error.message);
  let rows = (data ?? []) as unknown as Row[];
  const expiring = rows.filter((r) => {
    const left = daysUntil(r.expires_on);
    return left !== null && left <= Math.max(r.remind_days, 30);
  });
  if (view === "expiring") rows = expiring.sort((a, b) => (a.expires_on ?? "").localeCompare(b.expires_on ?? ""));
  const linkOf = (r: Row) => r.product?.name ?? r.supplier?.name ?? r.client?.name ?? r.tender?.number ?? r.contract?.number ?? "";
  if (q) rows = rows.filter((r) => `${r.title} ${r.reference ?? ""} ${linkOf(r)}`.toLowerCase().includes(q));
  const href = (v: string) => `/documents?view=${v}${kind ? `&kind=${kind}` : ""}`;

  return (
    <>
      <div className="page-head">
        <h1>{tr("Documents")}</h1>
        <Link href="/documents/new" className="btn btn-primary btn-small">
          {tr("+ Document")}
        </Link>
      </div>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Show")}>
        <Link href={href("all")} aria-current={view === "all" ? "page" : undefined}>
          {tr("All")}
        </Link>
        <Link href={href("expiring")} aria-current={view === "expiring" ? "page" : undefined}>
          {tr("Expiring")} {expiring.length > 0 && view !== "archive" ? `(${expiring.length})` : ""}
        </Link>
        <Link href={href("archive")} aria-current={view === "archive" ? "page" : undefined}>
          {tr("Archive")}
        </Link>
      </nav>
      <form method="get" className="inline-form" style={{ margin: "8px 0" }}>
        <input type="hidden" name="view" value={view} />
        <input type="search" name="q" defaultValue={q} placeholder={tr("Search name, number, supplier…")} aria-label={tr("Search")} />
        <select name="kind" defaultValue={kind} aria-label={tr("Type")}>
          <option value="">{tr("All types")}</option>
          {DOC_KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {tr(k.label)}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-small">
          {tr("Show")}
        </button>
      </form>
      {rows.length === 0 ? (
        <p className="card muted">
          {view === "expiring"
            ? tr("Nothing expiring soon.")
            : tr("No documents yet. Upload your business licence, tax clearance, supplier certificates and safety data sheets so they are always at hand.")}
        </p>
      ) : (
        <ul className="rec-list">
          {rows.map((r) => {
            const left = daysUntil(r.expires_on);
            return (
              <li key={r.id}>
                <Link href={`/documents/${r.id}`}>
                  <div className="main">
                    <div className="title">
                      {r.file_path ? "📎 " : ""}
                      {r.title}
                    </div>
                    <div className="sub">
                      {tr(docKindLabel(r.kind))}
                      {r.reference && ` · ${r.reference}`}
                      {linkOf(r) && ` · ${linkOf(r)}`}
                    </div>
                  </div>
                  <div className="side">
                    {r.expires_on && (
                      <div className={`small${left !== null && left <= r.remind_days ? " text-warn" : " muted"}`}>
                        {left !== null && left < 0 ? tr("Expired") : tr("Expires")} {formatDate(r.expires_on)}
                      </div>
                    )}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
