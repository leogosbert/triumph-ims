import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { quoteNo } from "@/lib/sales";
import { fmtQty } from "@/lib/stock";
import { newDelivery } from "../deliveries/actions";

export const metadata = { title: "Still to deliver" };

type QLine = { id: string; line_no: number; product_id: string | null; description: string; quantity: number; unit: string };
type Quote = {
  id: string;
  number: string;
  revision: number;
  decided_at: string | null;
  updated_at: string;
  client: { name: string } | null;
  lines: QLine[];
};
type DLine = { quotation_line_id: string; quantity: number; delivery: { status: string } | null };

export default async function BackordersPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeDeliveries")) redirect("/");
  const { data: qData, error } = await supabase
    .from("quotations")
    .select("id, number, revision, decided_at, updated_at, client:clients(name), lines:quotation_lines(id, line_no, product_id, description, quantity, unit)")
    .eq("company_id", company.id)
    .eq("status", "accepted")
    .order("updated_at", { ascending: false })
    .limit(300);
  if (error) throw new Error(error.message);
  const quotes = (qData ?? []) as unknown as Quote[];
  const lineIds = quotes.flatMap((q) => q.lines.map((l) => l.id));
  const [{ data: dData }, { data: ohData }] = await Promise.all([
    lineIds.length
      ? supabase.from("delivery_lines").select("quotation_line_id, quantity, delivery:deliveries(status)").in("quotation_line_id", lineIds).limit(20000)
      : Promise.resolve({ data: [] }),
    supabase.from("stock_on_hand").select("product_id, quantity").eq("company_id", company.id).limit(20000),
  ]);
  const sent = new Map<string, number>();
  const preparing = new Map<string, number>();
  for (const d of (dData ?? []) as unknown as DLine[]) {
    const st = d.delivery?.status;
    if (st === "failed" || st === "cancelled" || !st) continue;
    const m = st === "draft" ? preparing : sent;
    m.set(d.quotation_line_id, (m.get(d.quotation_line_id) ?? 0) + Number(d.quantity));
  }
  const stock = new Map<string, number>();
  for (const s of ohData ?? []) stock.set(s.product_id, (stock.get(s.product_id) ?? 0) + Number(s.quantity));

  const open = quotes
    .map((q) => ({
      ...q,
      lines: q.lines
        .map((l) => {
          const done = sent.get(l.id) ?? 0;
          const prep = preparing.get(l.id) ?? 0;
          const left = Math.max(Number(l.quantity) - done - prep, 0);
          const have = l.product_id ? (stock.get(l.product_id) ?? 0) : null;
          return { ...l, done, prep, left, have };
        })
        .filter((l) => l.left > 0 || l.prep > 0)
        .sort((a, b) => a.line_no - b.line_no),
    }))
    .filter((q) => q.lines.length > 0);
  const canDeliver = can(role, "editDeliveries");

  return (
    <>
      <p className="small">
        <Link href="/deliveries">{tr("← Deliveries")}</Link>
      </p>
      <h1>{tr("Still to deliver")}</h1>
      <p className="muted small">{tr("Accepted quotations whose goods have not all gone out yet, with the stock you have now.")}</p>
      <Notice {...notice} />
      {open.length === 0 ? (
        <p className="card muted">{tr("Everything accepted has been delivered.")}</p>
      ) : (
        open.map((q) => {
          const ready = q.lines.every((l) => l.left === 0 || (l.have !== null && l.have >= l.left));
          const anyLeft = q.lines.some((l) => l.left > 0);
          return (
            <section key={q.id} className="card">
              <div className="page-head" style={{ marginBottom: 4 }}>
                <h2 style={{ margin: 0 }}>{q.client?.name}</h2>
                {anyLeft && <span className={`badge ${ready ? "tone-ok" : "tone-warn"}`}>{ready ? tr("Stock ready") : tr("Short of stock")}</span>}
              </div>
              <p className="small muted">
                <Link href={`/quotations/${q.id}`}>{quoteNo(q)}</Link> · {tr("accepted")} {formatDate(q.decided_at ?? q.updated_at)}
              </p>
              <ul className="lines">
                {q.lines.map((l) => (
                  <li key={l.id}>
                    <div className="line-head">
                      <div>
                        <div className="desc">{l.description}</div>
                        <div className="muted small">
                          {tr("ordered")} {fmtQty(l.quantity)} · {tr("delivered")} {fmtQty(l.done)}
                          {l.prep > 0 && ` · ${tr("being prepared")} ${fmtQty(l.prep)}`}
                          {l.have !== null && (
                            <span className={l.have < l.left ? "text-warn" : undefined}>
                              {" "}
                              · {tr("in stock")} {fmtQty(l.have)}
                            </span>
                          )}
                        </div>
                      </div>
                      <strong style={{ whiteSpace: "nowrap" }}>
                        {fmtQty(l.left)} {l.unit}
                      </strong>
                    </div>
                  </li>
                ))}
              </ul>
              {canDeliver && anyLeft && (
                <form action={newDelivery} style={{ marginTop: 8 }}>
                  <input type="hidden" name="quotation_id" value={q.id} />
                  <SubmitButton className="btn btn-small" pendingText={tr("Creating…")}>
                    {tr("Make a delivery note for the rest")}
                  </SubmitButton>
                </form>
              )}
            </section>
          );
        })
      )}
    </>
  );
}
