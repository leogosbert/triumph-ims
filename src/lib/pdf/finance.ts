import { buildDocumentPdf, pdfDate, pdfMoney, type DocCompany, type DocLine } from "./document";

type Logo = { bytes: Uint8Array; type: "png" | "jpg" } | null;
type Party = { name: string; address: string | null; tin: string | null; vrn: string | null };

function partyLines(p: Party, attention?: string | null) {
  return [
    p.address,
    [p.tin ? `TIN: ${p.tin}` : null, p.vrn ? `VRN: ${p.vrn}` : null].filter(Boolean).join("   "),
    attention ? `Attention: ${attention}` : null,
  ];
}

export type InvoicePdfData = {
  company: DocCompany;
  logo: Logo;
  invoice: {
    number: string;
    status: string;
    issue_date: string | null;
    due_date: string | null;
    currency: string;
    client_ref: string | null;
    contact_name: string | null;
    quotation_number: string | null;
    delivery_number: string | null;
    payment_terms: string | null;
    vat_rate: number;
    subtotal: number;
    discount_total: number;
    vat_amount: number;
    total: number;
    amount_paid: number;
    notes: string | null;
    terms: string | null;
    issued_by: string | null;
  };
  client: Party;
  lines: DocLine[];
};

export function buildInvoicePdf(d: InvoicePdfData) {
  const i = d.invoice;
  const draft = i.status === "draft";
  const balance = i.total - i.amount_paid;
  const payment = [
    i.due_date ? `Please pay by ${pdfDate(i.due_date)}.` : null,
    i.payment_terms ? `Payment terms: ${i.payment_terms}` : null,
    i.amount_paid > 0
      ? `Paid so far: ${pdfMoney(i.amount_paid, i.currency)}   Balance due: ${pdfMoney(balance, i.currency)}`
      : null,
    `Please quote invoice number ${draft ? "(given when issued)" : i.number} with your payment.`,
  ]
    .filter(Boolean)
    .join("\n");
  return buildDocumentPdf({
    title: i.vat_rate > 0 && d.company.vrn ? "TAX INVOICE" : "INVOICE",
    company: d.company,
    logo: d.logo,
    meta: [
      ["Invoice no.", draft ? "DRAFT" : i.number],
      ["Date", pdfDate(i.issue_date)],
      ["Due date", pdfDate(i.due_date)],
      ["Your order no.", i.client_ref],
      ["Our quotation", i.quotation_number],
      ["Delivery note", i.delivery_number],
    ],
    partyLabel: "Bill to",
    party: { name: d.client.name, lines: partyLines(d.client, i.contact_name) },
    currency: i.currency,
    mode: "priced-discount",
    lines: d.lines,
    totals: {
      rows: [
        ...(i.discount_total > 0 ? ([["Discounts included", i.discount_total, true]] as [string, number, boolean][]) : []),
        ["Subtotal", i.subtotal],
        [`VAT ${Number(i.vat_rate)}%`, i.vat_amount],
      ],
      grandLabel: `TOTAL ${i.currency}`,
      grand: i.total,
    },
    blocks: [
      { title: "Payment", body: payment },
      { title: "Notes", body: i.notes },
      { title: "Terms", body: i.terms },
    ],
    showBank: true,
    signature: i.issued_by ? `Issued by: ${i.issued_by}\nFor and on behalf of ${d.company.name}` : null,
    watermark: draft ? "DRAFT - NOT ISSUED" : i.status === "cancelled" ? "CANCELLED" : i.status === "paid" ? "PAID" : null,
  });
}

export type ReceiptPdfData = {
  company: DocCompany;
  logo: Logo;
  receipt: {
    number: string;
    received_on: string;
    amount: number;
    currency: string;
    method: string;
    reference: string | null;
    invoice_number: string;
    invoice_total: number;
    balance_after: number;
    recorded_by: string | null;
  };
  client: Party;
};

export function buildReceiptPdf(d: ReceiptPdfData) {
  const r = d.receipt;
  return buildDocumentPdf({
    title: "RECEIPT",
    company: d.company,
    logo: d.logo,
    meta: [
      ["Receipt no.", r.number],
      ["Date", pdfDate(r.received_on)],
      ["Paid by", r.method],
      ["Reference", r.reference],
    ],
    partyLabel: "Received from",
    party: { name: d.client.name, lines: partyLines(d.client) },
    currency: r.currency,
    mode: "priced",
    lines: [
      {
        line_no: 1,
        description: `Payment against invoice ${r.invoice_number} (invoice total ${pdfMoney(r.invoice_total, r.currency)})`,
        sku: null,
        quantity: 1,
        unit: "",
        unit_price: r.amount,
        discount_pct: 0,
        line_total: r.amount,
      },
    ],
    totals: { rows: [], grandLabel: `RECEIVED ${r.currency}`, grand: r.amount },
    blocks: [
      {
        title: "Balance",
        body:
          r.balance_after > 0
            ? `Balance still due on invoice ${r.invoice_number}: ${pdfMoney(r.balance_after, r.currency)}`
            : `Invoice ${r.invoice_number} is fully paid. Thank you.`,
      },
    ],
    signature: r.recorded_by ? `Received by: ${r.recorded_by}\nFor and on behalf of ${d.company.name}` : null,
  });
}
