import { coverPct, estimatedInterest, FACILITY_LABEL } from "@/lib/growth-tools/financing";
import { clean, pdfDate, pdfMoney, type DocCompany } from "./document";
import { attachFile, attachPdf, Report } from "./report";

/**
 * The LPO financing pack: one PDF for the bank.
 *   1. Cover letter (amount, tenor, purpose, repayment from the client's invoice)
 *   2. Summary: the order, cost and margin, supplier quotes, the client's payment record, cash
 *   3. List of enclosures with page numbers
 *   then the client's LPO, our quotation, the client's statement, and the company papers
 *   (incorporation, TIN, VAT, tax clearance, business licence and active licences).
 */

type Money = number | string | null | undefined;
type DocRef = { id: string; title: string; file_path: string | null; file_name?: string | null; file_type: string | null; expires_on?: string | null; reference?: string | null };

export type FinancingPack = {
  request: Record<string, unknown> & {
    number: string;
    bank_name: string;
    bank_branch: string | null;
    bank_contact: string | null;
    facility: string;
    amount: Money;
    tenor_days: number;
    interest_rate: Money;
    purpose: string | null;
    repayment_source: string;
    lpo_number: string | null;
    lpo_date: string | null;
    lpo_amount: Money;
    currency: string;
    status: string;
    created_at: string;
  };
  quotation: { number: string; revision: number; issue_date: string; currency: string; exchange_rate: Money; subtotal: Money; vat_amount: Money; total: Money; client_ref: string | null; payment_terms: string | null; delivery_time: string | null; decided_at: string | null };
  margin: { revenue_base: Money; cost_base: Money; margin_pct: Money; lines_without_cost: number } | null;
  extra_costs: Money;
  client: { name: string; tin: string | null; vrn: string | null; address: string | null; industry: string | null; payment_terms: string | null } | null;
  client_record: { client_since: string | null; invoices: number; invoiced: Money; paid_invoices: number; on_time: number; avg_days_to_pay: Money; open: Money; overdue: Money; orders_won: number };
  supplier_quotes: { number: string; supplier: string; currency: string; exchange_rate: Money; lead_time_days: number | null; valid_until: string | null; awarded: boolean; total: Money; lines_priced: number; lines: number }[];
  purchase_orders: { number: string; supplier: string; status: string; currency: string; total: Money; total_base: Money }[];
  lpo_document: DocRef | null;
  compliance: { code: string; name: string; status: string | null; documents: DocRef[] }[];
  licences: { name: string; authority: string | null; licence_no: string | null; expires_on: string | null; documents: DocRef[] }[];
  library: (DocRef & { kind: string })[];
  cash: {
    months: { month: string; money_in: Money; paid_suppliers: Money; expenses: Money }[];
    cash_count: { as_of: string; amount: Money; note: string | null } | null;
    book_balances: { code: string; name: string; balance: Money }[];
    receivables: Money;
    payables: Money;
  };
};

const n = (v: Money) => (v == null || v === "" ? 0 : Number(v));

const STATUS_WORD: Record<string, string> = { done: "Ready", in_progress: "In progress", not_started: "Not done", not_applicable: "Not applicable" };

export type PackFile = { bytes: Uint8Array; type: string } | null;

export async function buildFinancingPack(d: {
  pack: FinancingPack;
  company: DocCompany & { base_currency?: string };
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  signedBy: string | null;
  quotationPdf: Uint8Array | null;
  statementPdf: Uint8Array | null;
  download: (path: string) => Promise<PackFile>;
  /** Time budget in ms for downloading the stored papers (Netlify stops at 10 s). */
  budgetMs?: number;
}): Promise<Uint8Array> {
  const p = d.pack;
  const f = p.request;
  const q = p.quotation;
  const base = d.company.base_currency ?? "TZS";
  const ccy = f.currency;
  const amount = n(f.amount);
  const lpoAmount = f.lpo_amount != null ? n(f.lpo_amount) : n(q.total);
  const rate = f.interest_rate != null && f.interest_rate !== "" ? n(f.interest_rate) : null;
  const interest = estimatedInterest(amount, rate, f.tenor_days);
  const cover = coverPct(amount, lpoAmount);
  const clientName = p.client?.name ?? "the client";
  const today = new Date().toISOString().slice(0, 10);
  const r = await Report.create(d.company, d.logo, `Financing request ${f.number}`, `Financing pack ${f.number} ${clientName}`);

  // ---------------- 1. Cover letter ----------------
  r.newPage(true);
  r.right(pdfDate(today), r.left + r.width, r.y);
  r.text(`Our ref: ${f.number}`, r.left, r.y, { color: r.muted });
  r.space(26);
  r.para(["The Manager", f.bank_name, f.bank_branch].filter(Boolean).join("\n"), { gap: 2 });
  if (f.bank_contact) r.para(`Attention: ${f.bank_contact}`, { color: r.muted });
  r.space(10);
  r.para(
    `RE: REQUEST FOR ${(FACILITY_LABEL[f.facility] ?? "financing").toUpperCase()} OF ${ccy} ${pdfMoney(amount, ccy)} AGAINST ${f.lpo_number ? `LPO NO. ${f.lpo_number}` : "A CLIENT ORDER"} FROM ${clientName.toUpperCase()}`,
    { bold: true, gap: 10 },
  );
  r.para("Dear Sir/Madam,", { gap: 8 });
  r.para(
    `We have received a local purchase order${f.lpo_number ? ` no. ${f.lpo_number}` : ""}${f.lpo_date ? ` dated ${pdfDate(f.lpo_date)}` : ""} from ${clientName} for ${ccy} ${pdfMoney(lpoAmount, ccy)} (our quotation ${q.number}). ${f.purpose ?? ""}`,
    { gap: 8 },
  );
  r.para(
    `We kindly request ${FACILITY_LABEL[f.facility]?.toLowerCase() ?? "financing"} of ${ccy} ${pdfMoney(amount, ccy)}${cover ? ` (${cover}% of the order value)` : ""} for ${f.tenor_days} days${rate ? `, at the rate of ${rate}% a year as discussed` : ""}. ${f.repayment_source ? `The facility will be repaid from: ${f.repayment_source.replace(/\.$/, "")}.` : ""}${p.client?.payment_terms || q.payment_terms ? ` The client's payment terms are ${p.client?.payment_terms ?? q.payment_terms}.` : ""}`,
    { gap: 8 },
  );
  r.para(
    `${clientName} has been our client${p.client_record.client_since ? ` since ${pdfDate(p.client_record.client_since)}` : ""}${p.client_record.paid_invoices ? `, and has paid ${p.client_record.on_time} of its last ${p.client_record.paid_invoices} invoices on time` : ""}. The enclosed pack contains the order, our quotation and the supplier quotations with our cost and margin, the client's statement and payment record, a summary of our cash flow and copies of our company registration and tax papers.`,
    { gap: 8 },
  );
  r.para("We will be glad to provide any further information you may need. Thank you for your continued support.", { gap: 16 });
  r.para("Yours faithfully,", { gap: 30 });
  r.page.drawLine({ start: { x: r.left, y: r.y + 8 }, end: { x: r.left + 180, y: r.y + 8 }, thickness: 0.5, color: r.muted });
  r.para(d.signedBy ?? "", { bold: true, gap: 1 });
  r.para(`For and on behalf of ${d.company.legal_name || d.company.name}`, { color: r.muted });

  // ---------------- 2. Summary ----------------
  r.newPage(false);
  r.title("Financing summary");
  r.heading("The request");
  r.rows([
    ["Bank", [f.bank_name, f.bank_branch].filter(Boolean).join(", ")],
    ["Facility", FACILITY_LABEL[f.facility] ?? f.facility],
    ["Amount requested", `${ccy} ${pdfMoney(amount, ccy)}${cover ? `  (${cover}% of the order)` : ""}`],
    ["Tenor", `${f.tenor_days} days`],
    ["Interest rate", rate ? `${rate}% a year${interest ? `  (about ${ccy} ${pdfMoney(interest, ccy)} for the tenor)` : ""}` : null],
    ["Repayment from", f.repayment_source],
  ]);
  r.heading("The order");
  r.rows([
    ["Client", clientName],
    ["Client TIN / VRN", [p.client?.tin, p.client?.vrn].filter(Boolean).join(" / ") || null],
    ["Industry", p.client?.industry],
    ["LPO number and date", [f.lpo_number, f.lpo_date ? pdfDate(f.lpo_date) : null].filter(Boolean).join(", ") || null],
    ["Order value", `${q.currency} ${pdfMoney(lpoAmount, q.currency)} (VAT ${q.currency} ${pdfMoney(n(q.vat_amount), q.currency)} included)`],
    ["Our quotation", `${q.number}, ${pdfDate(q.issue_date)}`],
    ["Delivery", q.delivery_time],
    ["Client's payment terms", p.client?.payment_terms ?? q.payment_terms],
  ]);
  if (p.margin) {
    const rev = n(p.margin.revenue_base);
    const cost = n(p.margin.cost_base);
    const extra = n(p.extra_costs);
    const gross = rev - cost - extra;
    r.heading(`Cost and margin (${base}, before VAT)`);
    r.table(
      [
        { label: "Item", width: 300 },
        { label: base, width: 140, align: "right" },
        { label: "% of sale", width: 80, align: "right" },
      ],
      [
        ["Sale value (our quotation)", pdfMoney(rev, base), "100%"],
        ["Cost of goods (supplier prices)", pdfMoney(cost, base), rev ? `${Math.round((cost / rev) * 100)}%` : ""],
        ...(extra ? [["Freight, clearing and other order costs", pdfMoney(extra, base), rev ? `${Math.round((extra / rev) * 100)}%` : ""]] : []),
        ["Gross margin", pdfMoney(gross, base), rev ? `${Math.round((gross / rev) * 1000) / 10}%` : ""],
      ],
      { totalRow: true },
    );
    if (p.margin.lines_without_cost > 0) r.para(`${p.margin.lines_without_cost} line(s) have no cost entered yet; the margin will be lower when they are costed.`, { size: 8.5, color: r.muted });
  }
  if (p.supplier_quotes.length) {
    r.heading("Supplier quotations");
    r.table(
      [
        { label: "Supplier", width: 190 },
        { label: "Request", width: 90 },
        { label: "Lead time", width: 70 },
        { label: "Priced", width: 60, align: "right" },
        { label: "Total", width: 130, align: "right" },
      ],
      p.supplier_quotes.map((s) => [
        `${s.supplier}${s.awarded ? " (chosen)" : ""}`,
        s.number,
        s.lead_time_days != null ? `${s.lead_time_days} days` : "",
        `${s.lines_priced}/${s.lines}`,
        `${s.currency} ${pdfMoney(n(s.total), s.currency)}`,
      ]),
    );
  }
  if (p.purchase_orders.length) {
    r.heading("Purchase orders to suppliers");
    r.table(
      [
        { label: "PO", width: 100 },
        { label: "Supplier", width: 220 },
        { label: "Status", width: 90 },
        { label: "Total", width: 130, align: "right" },
      ],
      p.purchase_orders.map((po) => [po.number, po.supplier, po.status.replace(/_/g, " "), `${po.currency} ${pdfMoney(n(po.total), po.currency)}`]),
    );
  }
  const cr = p.client_record;
  r.heading(`The client's payment record (last 24 months, ${base})`);
  r.rows([
    ["Client since", cr.client_since ? pdfDate(cr.client_since) : "New client"],
    ["Invoices", `${cr.invoices} invoices, ${base} ${pdfMoney(n(cr.invoiced), base)}`],
    ["Paid on time", cr.paid_invoices ? `${cr.on_time} of ${cr.paid_invoices} paid invoices` : "No paid invoices yet"],
    ["Average days to pay", cr.avg_days_to_pay != null ? `${n(cr.avg_days_to_pay)} days` : null],
    ["Still open", `${base} ${pdfMoney(n(cr.open), base)}${n(cr.overdue) ? `  (overdue ${base} ${pdfMoney(n(cr.overdue), base)})` : ""}`],
    ["Orders received", String(cr.orders_won)],
  ]);
  const c = p.cash;
  if (c.months.length) {
    r.heading(`Money in and out, last ${c.months.length} months (${base})`);
    const rows = c.months.map((m) => {
      const out = n(m.paid_suppliers) + n(m.expenses);
      return [pdfDate(m.month).slice(3), pdfMoney(n(m.money_in), base), pdfMoney(n(m.paid_suppliers), base), pdfMoney(n(m.expenses), base), pdfMoney(n(m.money_in) - out, base)];
    });
    const sum = (k: "money_in" | "paid_suppliers" | "expenses") => c.months.reduce((s, m) => s + n(m[k]), 0);
    rows.push(["Total", pdfMoney(sum("money_in"), base), pdfMoney(sum("paid_suppliers"), base), pdfMoney(sum("expenses"), base), pdfMoney(sum("money_in") - sum("paid_suppliers") - sum("expenses"), base)]);
    r.table(
      [
        { label: "Month", width: 80 },
        { label: "Received from clients", width: 120, align: "right" },
        { label: "Paid to suppliers", width: 110, align: "right" },
        { label: "Expenses", width: 100, align: "right" },
        { label: "Net", width: 100, align: "right" },
      ],
      rows,
      { totalRow: true },
    );
  }
  r.rows([
    ["Clients owe us", `${base} ${pdfMoney(n(c.receivables), base)}`],
    ["We owe suppliers", `${base} ${pdfMoney(n(c.payables), base)}`],
    ["Last cash count", c.cash_count ? `${base} ${pdfMoney(n(c.cash_count.amount), base)} on ${pdfDate(c.cash_count.as_of)}` : null],
    ...c.book_balances.map((b) => [`Book balance: ${b.name}`, `${base} ${pdfMoney(n(b.balance), base)}`] as [string, string]),
  ]);
  r.para("Figures are from our books in LeMoSp as at the date of this pack and are not audited.", { size: 8, color: r.muted });

  // ---------------- 3. Enclosures (filled in once the page numbers are known) ----------------
  r.newPage(false);
  const indexPage = r.page;
  const indexTop = r.y;
  type Entry = { title: string; page: number | null; note: string };
  const entries: Entry[] = [
    { title: "Cover letter", page: 1, note: "" },
    { title: "Financing summary", page: 2, note: "" },
  ];

  const started = Date.now();
  const budget = d.budgetMs ?? 5000;
  const seen = new Set<string>();
  const addStored = async (title: string, doc: DocRef | null | undefined, missing: string) => {
    if (!doc?.file_path) {
      entries.push({ title, page: null, note: missing });
      return;
    }
    if (seen.has(doc.id)) {
      entries.push({ title, page: null, note: "Same copy as above" });
      return;
    }
    if (Date.now() - started > budget) {
      entries.push({ title, page: null, note: "Not added (time limit): download the pack again or attach by hand" });
      return;
    }
    seen.add(doc.id);
    const file = await d.download(doc.file_path);
    if (!file) {
      entries.push({ title, page: null, note: "The file could not be opened" });
      return;
    }
    const res = await attachFile(r, file.bytes, file.type, `${title}: ${doc.title}`);
    entries.push({
      title,
      page: res.first,
      note: res.error ?? [doc.reference ? `No. ${doc.reference}` : null, doc.expires_on ? `valid until ${pdfDate(doc.expires_on)}` : null].filter(Boolean).join(", "),
    });
  };

  await addStored("Client's LPO", p.lpo_document, "Attach the LPO copy to the request in the app");
  if (d.quotationPdf) {
    const res = await attachPdf(r, d.quotationPdf);
    entries.push({ title: `Our quotation ${q.number}`, page: res.first, note: res.error ?? "" });
  }
  if (d.statementPdf) {
    const res = await attachPdf(r, d.statementPdf);
    entries.push({ title: `Statement of account: ${clientName}`, page: res.first, note: res.error ?? "Last 12 months" });
  }
  const KIND_FOR: Record<string, string[]> = {
    BRELA_INCORPORATION: ["company"],
    BRELA_MEMART: ["company"],
    TRA_TIN: ["tax"],
    TRA_VAT_REGISTRATION: ["tax"],
    TRA_TAX_CLEARANCE: ["tax"],
    BUSINESS_LICENCE: ["licence"],
  };
  const WORDS: Record<string, RegExp> = {
    BRELA_INCORPORATION: /incorporat|brela|registration cert/i,
    BRELA_MEMART: /memart|memorandum|articles/i,
    TRA_TIN: /\btin\b|taxpayer/i,
    TRA_VAT_REGISTRATION: /\bvat\b|\bvrn\b/i,
    TRA_TAX_CLEARANCE: /clearance/i,
    BUSINESS_LICENCE: /business licen|trading licen|leseni/i,
  };
  for (const item of p.compliance) {
    const linked = item.documents[0] ?? p.library.find((l) => (KIND_FOR[item.code] ?? []).includes(l.kind) && WORDS[item.code]?.test(`${l.title} ${l.file_name ?? ""}`));
    const status = item.status ? STATUS_WORD[item.status] ?? item.status : "Not on the checklist";
    if (item.status === "not_applicable" && !linked) continue;
    await addStored(item.name, linked, `${status}: no copy in the documents library`);
  }
  for (const l of p.licences.slice(0, 6)) {
    await addStored(`${l.name}${l.licence_no ? ` (${l.licence_no})` : ""}`, l.documents[0], "No copy in the documents library");
  }

  // Index page text.
  r.page = indexPage;
  r.y = indexTop;
  r.title("Enclosures");
  r.table(
    [
      { label: "#", width: 30 },
      { label: "Document", width: 260 },
      { label: "Page", width: 50, align: "right" },
      { label: "Note", width: 200 },
    ],
    entries.map((e, i) => [String(i + 1), e.title, e.page ? String(e.page) : "-", e.page ? e.note : e.note || "Not attached"]),
  );
  r.para("Pages without a number were not attached; the note says why. Originals are available on request.", { size: 8, color: r.muted });
  // A long index could spill onto a page added at the end of the document; acceptable (at most ~30 rows fit).

  r.footers(`${clean(d.company.name)} - financing request ${f.number} - ${pdfDate(today)}`);
  return r.doc.save();
}
