import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { StatusBadge } from "@/lib/sales";
import { HIRE_STATUS, RATE_PERIODS, canInvoiceService, canPlanService, canSeeAllService, todayTz } from "@/lib/services";
import { addHireLine, cancelHire, invoiceHire, removeHireLine, returnHire, saveHire } from "../actions";
import { chargeBetween, isOverdue, perPeriod, unbilledSpan, type Hire, type HireLine } from "../calc";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Hire" };

type Line = HireLine & { product: { name: string; sku: string; unit: string } | null };

const qty = (n: number) => (Number.isInteger(Number(n)) ? String(Number(n)) : Number(n).toLocaleString("en-GB", { maximumFractionDigits: 3 }));

export default async function HireDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!canSeeAllService(roles)) redirect("/");
  const { data, error } = await supabase
    .from("hire_agreements")
    .select("*, client:clients(name)")
    .eq("id", id)
    .eq("company_id", company.id)
    .maybeSingle();
  if (isMissingTable(error)) return <NotReady title="Hire" />;
  if (error) throw new Error(error.message);
  if (!data) notFound();
  const h = data as unknown as Hire;
  const today = todayTz();
  const planner = canPlanService(roles);
  const out = h.status === "out";
  const editableLines = out && !h.invoiced_until && planner;

  const [{ data: lineData }, names] = await Promise.all([
    supabase.from("hire_lines").select("id, product_id, description, quantity, rate, product:products(name, sku, unit)").eq("agreement_id", id).order("created_at"),
    namesFor(supabase, [h.created_by]),
  ]);
  const lines = (lineData ?? []) as unknown as Line[];

  let choices: { id: string; name: string; sku: string; unit: string; free: number | null }[] = [];
  if (editableLines) {
    const { data: itemData } = await supabase
      .from("products")
      .select("id, name, sku, unit")
      .eq("company_id", company.id)
      .eq("item_type", "hire")
      .eq("active", true)
      .order("name")
      .limit(60);
    const items = (itemData ?? []) as { id: string; name: string; sku: string; unit: string }[];
    choices = await Promise.all(
      items.map(async (p) => {
        const { data: r } = await supabase.rpc("hire_available", { p_company: company.id, p_product: p.id });
        const row = (Array.isArray(r) ? r[0] : r) as { owned: number; on_hire: number; tracked: boolean } | null;
        const free = row?.tracked ? Math.max(Number(row.owned) - Number(row.on_hire), 0) : null;
        return { id: p.id, name: p.name, sku: p.sku, unit: p.unit, free };
      }),
    );
  }

  const span = unbilledSpan(h, today);
  const running = span.open && (h.status === "out" || h.status === "returned") ? chargeBetween(lines, span.from, span.to, h.rate_period) : null;
  const period = tr(RATE_PERIODS[h.rate_period]?.per ?? h.rate_period);
  const canInvoice = canInvoiceService(roles) && (h.status === "out" || h.status === "returned") && span.open;

  return (
    <>
      <BackLink href="/hire" label="Equipment hire" />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{h.number}</h1>
        <span>
          {isOverdue(h, today) && <span className="badge tone-bad">{tr("Overdue")}</span>} <StatusBadge map={HIRE_STATUS} status={h.status} />
        </span>
      </div>
      <p className="muted small">
        {h.client?.name}
        {h.site && ` · ${h.site}`}
        {h.contact && ` · ${h.contact}`}
        {h.created_by && names.get(h.created_by) && ` · ${tr("prepared by")} ${names.get(h.created_by)}`}
      </p>
      <p className="small">
        {tr("Out")} {formatDate(h.out_on)}
        {h.due_back_on && ` · ${tr("Due back")} ${formatDate(h.due_back_on)}`}
        {h.returned_on && ` · ${tr("Returned")} ${formatDate(h.returned_on)}`}
        {` · ${tr(RATE_PERIODS[h.rate_period]?.label ?? h.rate_period)}`}
        {h.deposit != null && ` · ${tr("Deposit")} ${formatMoney(h.deposit, h.currency)}`}
      </p>
      {h.invoiced_until && (
        <p className="small">
          {tr("Invoiced up to")} <strong>{formatDate(h.invoiced_until)}</strong>
        </p>
      )}
      {h.return_note && <p className="small">{h.return_note}</p>}
      {h.notes && <p className="small muted">{h.notes}</p>}
      <Notice {...notice} />

      <section className="card" id="items">
        <h2>
          {tr("Items")} <span className="small muted">· {lines.length}</span>
        </h2>
        {lines.length === 0 ? (
          <p className="muted small">{tr("No items yet. Add what goes out on this hire below.")}</p>
        ) : (
          <ul className="lines">
            {lines.map((l) => (
              <li key={l.id}>
                <div className="line-head">
                  <div>
                    <div className="desc">{l.description}</div>
                    <div className="muted small">
                      {l.product?.sku} · {formatMoney(l.rate, h.currency)} / {period}
                    </div>
                  </div>
                  <strong style={{ whiteSpace: "nowrap" }}>
                    {qty(l.quantity)} {l.product?.unit}
                  </strong>
                </div>
                {editableLines && (
                  <form action={removeHireLine}>
                    <input type="hidden" name="agreement_id" value={h.id} />
                    <input type="hidden" name="line_id" value={l.id} />
                    <button type="submit" className="btn btn-small">
                      {tr("Remove")}
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {lines.length > 0 && (
          <p className="small">
            {tr("Per period")}: <strong>{formatMoney(perPeriod(lines), h.currency)}</strong> / {period}
          </p>
        )}
        {editableLines && (
          <form action={addHireLine} style={{ marginTop: 12 }}>
            <input type="hidden" name="agreement_id" value={h.id} />
            {choices.length === 0 ? (
              <p className="muted small">
                {tr("No hire items yet.")} <Link href="/products/new?type=hire">{tr("+ Hire item")}</Link>
              </p>
            ) : (
              <>
                <div className="grid grid-2">
                  <div className="field" style={{ gridColumn: "1 / -1" }}>
                    <label htmlFor="product_id">{tr("Hire item")}</label>
                    <select id="product_id" name="product_id" required defaultValue="">
                      <option value="" disabled>
                        {tr("Choose…")}
                      </option>
                      {choices.map((p) => (
                        <option key={p.id} value={p.id} disabled={p.free === 0}>
                          {p.name} ({p.sku}) · {p.free === null ? tr("not counted") : `${tr("free")} ${qty(p.free)} ${p.unit}`}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="quantity">{tr("Quantity")}</label>
                    <input id="quantity" name="quantity" type="text" inputMode="decimal" required defaultValue="1" />
                  </div>
                  <div className="field">
                    <label htmlFor="rate">
                      {tr("Rate")} ({h.currency} / {period})
                    </label>
                    <input id="rate" name="rate" type="text" inputMode="decimal" required />
                  </div>
                </div>
                <SubmitButton className="btn btn-small">{tr("Add item")}</SubmitButton>
              </>
            )}
          </form>
        )}
      </section>

      {running && (
        <section className="card">
          <h2>{tr("Charge so far")}</h2>
          <p className="small muted">
            {formatDate(span.from)} → {formatDate(span.to)} · {running.periods} × {period}
            {h.invoiced_until ? ` · ${tr("not invoiced yet")}` : ""}
          </p>
          <p>
            <strong style={{ fontSize: "1.3rem" }}>{formatMoney(running.amount, h.currency)}</strong>
          </p>
          {canInvoice && (
            <form action={invoiceHire}>
              <input type="hidden" name="id" value={h.id} />
              {out && (
                <div className="field">
                  <label htmlFor="until">{tr("Invoice up to")}</label>
                  <input id="until" name="until" type="date" defaultValue={today} min={span.from} max={today} />
                </div>
              )}
              <SubmitButton disabled={lines.length === 0}>{tr("Make invoice")}</SubmitButton>
            </form>
          )}
        </section>
      )}

      {out && planner && (
        <section className="card">
          <h2>{tr("Record return")}</h2>
          <form action={returnHire}>
            <input type="hidden" name="id" value={h.id} />
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="returned_on">{tr("Returned on")}</label>
                <input id="returned_on" name="returned_on" type="date" defaultValue={today} min={h.out_on} max={today} required />
              </div>
              <div className="field">
                <label htmlFor="note">{tr("Note")}</label>
                <input id="note" name="note" type="text" maxLength={1000} placeholder={tr("e.g. All back in good condition")} />
              </div>
            </div>
            <SubmitButton>{tr("Record return")}</SubmitButton>
          </form>
        </section>
      )}

      {out && planner && (
        <section className="card">
          <h2>{tr("Hire details")}</h2>
          <form action={saveHire}>
            <input type="hidden" name="id" value={h.id} />
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="site">{tr("Site")}</label>
                <input id="site" name="site" type="text" maxLength={300} defaultValue={h.site ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="contact">{tr("Contact on site")}</label>
                <input id="contact" name="contact" type="text" maxLength={200} defaultValue={h.contact ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="due_back_on">{tr("Due back")}</label>
                <input id="due_back_on" name="due_back_on" type="date" min={h.out_on} defaultValue={h.due_back_on ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="deposit">
                  {tr("Deposit")} ({h.currency})
                </label>
                <input id="deposit" name="deposit" type="text" inputMode="decimal" defaultValue={h.deposit ?? ""} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="notes">{tr("Notes")}</label>
                <textarea id="notes" name="notes" rows={3} maxLength={2000} defaultValue={h.notes ?? ""} />
              </div>
            </div>
            <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
          </form>
          {!h.invoiced_until && (
            <form action={cancelHire} style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={h.id} />
              <p className="muted small">{tr("Cancel only a hire entered by mistake. Nothing is invoiced.")}</p>
              <SubmitButton className="btn btn-small" pendingText="…">
                {tr("Cancel hire")}
              </SubmitButton>
            </form>
          )}
        </section>
      )}
    </>
  );
}
