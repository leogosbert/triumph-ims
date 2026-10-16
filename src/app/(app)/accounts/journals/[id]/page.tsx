import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDate, formatDateTime } from "@/lib/format";
import { canReverseByHand, sourceHref, sourceLabel, type Journal } from "@/lib/ledger";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { reverseJournal } from "../../actions";
import { partyNames } from "../../lines";
import { BackLink, amt, drCr, ledgerContext } from "../../shared";

export const metadata = { title: "Journal" };

type Line = {
  id: string;
  debit: number;
  credit: number;
  description: string | null;
  client_id: string | null;
  supplier_id: string | null;
  account: { id: string; code: string; name: string } | null;
};

export default async function JournalPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const lang = await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company } = await ledgerContext();
  const base = company.base_currency;
  const w = drCr(lang);
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const { data: jd } = await supabase
    .from("gl_journals")
    .select("id, number, entry_date, doc_date, memo, source, source_id, source_ref, reverses, reversed_by, created_by, created_at")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!jd) notFound();
  const j = jd as Journal;

  const linked = [j.reverses, j.reversed_by].filter((x): x is string => !!x);
  const [{ data: ld }, { data: rel }, people, billRes] = await Promise.all([
    supabase.from("gl_lines").select("id, debit, credit, description, client_id, supplier_id, account:gl_accounts(id, code, name)").eq("journal_id", id),
    linked.length ? supabase.from("gl_journals").select("id, number").in("id", linked) : Promise.resolve({ data: [] }),
    namesFor(supabase, [j.created_by]),
    j.source === "supplier_payments" && j.source_id
      ? supabase.from("supplier_payments").select("id, bill_id").eq("id", j.source_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const lines = ((ld ?? []) as unknown as Line[]).sort((a, b) => Number(b.debit) - Number(a.debit) || (a.account?.code ?? "").localeCompare(b.account?.code ?? ""));
  const names = await partyNames(supabase, lines);
  const relNo = new Map(((rel ?? []) as { id: string; number: string }[]).map((r) => [r.id, r.number]));
  const billOf = new Map<string, string>();
  const bill = billRes.data as { id: string; bill_id: string } | null;
  if (bill) billOf.set(bill.id, bill.bill_id);
  const docHref = sourceHref(j.source, j.source_id, billOf);
  const dr = lines.reduce((s, l) => s + Number(l.debit), 0);
  const cr = lines.reduce((s, l) => s + Number(l.credit), 0);

  return (
    <>
      <BackLink href="/accounts/journals" label="← Journals" />
      <h1>
        {tr("Journal")} {j.number}
      </h1>
      <Notice {...notice} />
      <section className="card">
        <p style={{ marginTop: 0 }}>
          <strong>{j.memo}</strong>{" "}
          {j.reversed_by && <span className="badge tone-off">{tr("Reversed")}</span>}
          {j.reverses && <span className="badge tone-warn">{tr("Reversal")}</span>}
        </p>
        <p className="small">
          {tr("Date in the books")}: {formatDate(j.entry_date)}
          {j.doc_date && j.doc_date !== j.entry_date && (
            <>
              {" "}
              · {tr("Document date")}: {formatDate(j.doc_date)}
            </>
          )}
        </p>
        <p className="small">
          {tr("Posted from")}: {tr(sourceLabel(j.source))}
          {j.source_ref && ` · ${j.source_ref}`}
          {docHref && (
            <>
              {" "}
              · <Link href={docHref}>{tr("Open the document")}</Link>
            </>
          )}
        </p>
        {j.reverses && (
          <p className="small">
            {tr("Reverses")} <Link href={`/accounts/journals/${j.reverses}`}>{relNo.get(j.reverses) ?? tr("the original")}</Link>
          </p>
        )}
        {j.reversed_by && (
          <p className="small">
            {tr("Reversed by")} <Link href={`/accounts/journals/${j.reversed_by}`}>{relNo.get(j.reversed_by) ?? tr("a reversal")}</Link>
          </p>
        )}
        <p className="small muted">
          {j.created_by ? `${people.get(j.created_by) ?? ""} · ` : ""}
          {formatDateTime(j.created_at)}
        </p>
      </section>

      <section className="card">
        <div className="scroll-x">
          <table className="compare rep-table">
            <thead>
              <tr>
                <th>{tr("Account")}</th>
                <th>{tr("Description")}</th>
                <th className="num">{w.dr}</th>
                <th className="num">{w.cr}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const party = names.get(l.client_id ?? l.supplier_id ?? "");
                return (
                  <tr key={l.id}>
                    <td>
                      {l.account ? (
                        <Link href={`/accounts/ledger/${l.account.id}`}>
                          <span className="muted small">{l.account.code}</span> {l.account.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      {l.description}
                      {party && <div className="small muted">{party}</div>}
                    </td>
                    <td className="num">{Number(l.debit) ? amt(Number(l.debit), base) : ""}</td>
                    <td className="num">{Number(l.credit) ? amt(Number(l.credit), base) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>{tr("Total")}</td>
                <td></td>
                <td className="num">{amt(dr, base)}</td>
                <td className="num">{amt(cr, base)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {canReverseByHand(j) ? (
        <form action={reverseJournal} className="card">
          <input type="hidden" name="id" value={j.id} />
          <p className="small muted" style={{ marginTop: 0 }}>
            {tr("Reversing posts the same lines the other way on the first open day. The original stays in the books.")}
          </p>
          <SubmitButton className="btn btn-danger btn-small" pendingText={tr("Posting…")}>
            {tr("Reverse this journal")}
          </SubmitButton>
        </form>
      ) : (
        !j.reverses &&
        !j.reversed_by &&
        j.source !== "manual" &&
        j.source !== "opening" && <p className="small muted">{tr("This entry comes from a document. Change or cancel the document and the books correct themselves.")}</p>
      )}
    </>
  );
}
