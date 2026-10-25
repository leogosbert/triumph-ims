import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { can } from "@/lib/roles";
import { quoteNo } from "@/lib/sales";
import { createRequest } from "../actions";
import { RequestFields } from "../RequestFields";

export const metadata = { title: "New financing request" };

export default async function NewFinancingPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role, features, isManager } = await getAppContext();
  if (!can(role, "seeFinance")) redirect("/");
  if (!features.on("lpo_financing")) return <FeatureOff title="LPO financing" isManager={isManager} />;
  const qid = typeof sp.quotation === "string" && /^[0-9a-f-]{36}$/i.test(sp.quotation) ? sp.quotation : null;

  if (!qid) {
    const { data: orders } = await supabase
      .from("quotations")
      .select("id, number, revision, total, currency, client_ref, decided_at, issue_date, client:clients(name)")
      .eq("company_id", company.id)
      .eq("status", "accepted")
      .order("decided_at", { ascending: false, nullsFirst: false })
      .limit(100);
    type O = { id: string; number: string; revision: number; total: number; currency: string; client_ref: string | null; decided_at: string | null; issue_date: string; client: { name: string } | null };
    return (
      <>
        <p className="small">
          <Link href="/financing">{tr("← LPO financing")}</Link>
        </p>
        <h1>{tr("Which order?")}</h1>
        <p className="muted small">{tr("Choose the client's order (an accepted quotation) to finance.")}</p>
        <Notice {...notice} />
        {(orders ?? []).length === 0 ? (
          <p className="card muted">{tr("No accepted quotations yet. Mark a quotation as accepted when the client's LPO arrives.")}</p>
        ) : (
          <ul className="rec-list">
            {((orders ?? []) as unknown as O[]).map((o) => (
              <li key={o.id}>
                <Link href={`/financing/new?quotation=${o.id}`}>
                  <div className="main">
                    <div className="title">{o.client?.name}</div>
                    <div className="sub">
                      {quoteNo(o)}
                      {o.client_ref && ` · LPO ${o.client_ref}`}
                      {" · "}
                      {formatDate(o.decided_at ?? o.issue_date)}
                    </div>
                  </div>
                  <div className="side small">{formatMoney(o.total, o.currency)}</div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }

  const { data: q } = await supabase
    .from("quotations")
    .select("id, number, revision, status, total, currency, exchange_rate, client_id, client_ref, client:clients(name)")
    .eq("id", qid)
    .eq("company_id", company.id)
    .maybeSingle();
  if (!q) redirect("/financing/new");
  const [{ data: margin }, { data: docs }, { data: existing }] = await Promise.all([
    supabase.from("quotation_margins").select("cost_base").eq("quotation_id", qid).maybeSingle(),
    supabase.from("documents").select("id, title, kind").eq("company_id", company.id).eq("client_id", q.client_id).is("archived_at", null).not("file_path", "is", null).order("created_at", { ascending: false }).limit(50),
    supabase.from("financing_requests").select("id, number, status").eq("quotation_id", qid).limit(5),
  ]);
  const client = (q.client as unknown as { name: string } | null)?.name ?? "";
  const cost = margin?.cost_base ? Math.round(Number(margin.cost_base) / Number(q.exchange_rate || 1)) : null;
  const back = `/financing/new?quotation=${qid}`;

  return (
    <>
      <p className="small">
        <Link href="/financing">{tr("← LPO financing")}</Link>
      </p>
      <h1>{tr("New financing request")}</h1>
      <p className="muted small">
        {client} · {quoteNo(q)}
        {q.client_ref && ` · LPO ${q.client_ref}`} · {formatMoney(q.total, q.currency)}
      </p>
      <Notice {...notice} />
      {q.status !== "accepted" && <div className="banner warn small">{tr("Mark the quotation as accepted (the client's order received) first.")}</div>}
      {(existing ?? []).length > 0 && (
        <div className="banner small">
          {tr("This order already has a request")}:{" "}
          {(existing ?? []).map((e) => (
            <Link key={e.id} href={`/financing/${e.id}`} style={{ marginRight: 8 }}>
              {e.number}
            </Link>
          ))}
        </div>
      )}
      <form action={createRequest} className="card grid grid-2">
        <input type="hidden" name="quotation_id" value={qid} />
        <RequestFields
          start={{ lpo_number: q.client_ref, lpo_amount: q.total }}
          currency={q.currency}
          docs={docs ?? []}
          uploadHref={`/documents/new?client=${q.client_id}&kind=other&back=${encodeURIComponent(back)}`}
          amountHint={cost ? formatMoney(cost, q.currency) : null}
        />
        <SubmitButton className="btn btn-primary" pendingText="…">
          {tr("Save request")}
        </SubmitButton>
      </form>
    </>
  );
}
