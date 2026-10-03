import { buildDocumentPdf, pdfDate, type DocCompany } from "./document";

export type QuotePdfData = {
  company: DocCompany;
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  quote: {
    number: string;
    status: string;
    issue_date: string;
    valid_until: string | null;
    currency: string;
    contact_name: string | null;
    client_ref: string | null;
    rfq_number: string | null;
    delivery_time: string | null;
    payment_terms: string | null;
    incoterms: string | null;
    vat_rate: number;
    subtotal: number;
    discount_total: number;
    vat_amount: number;
    total: number;
    notes: string | null;
    terms: string | null;
    prepared_by: string | null;
  };
  client: { name: string; address: string | null; tin: string | null; vrn: string | null };
  lines: {
    line_no: number;
    description: string;
    sku: string | null;
    quantity: number;
    unit: string;
    unit_price: number;
    discount_pct: number;
    line_total: number;
  }[];
};

export function buildQuotationPdf(d: QuotePdfData) {
  const q = d.quote;
  const approved = ["approved", "sent", "accepted"].includes(q.status);
  const commercial = [
    q.delivery_time ? `Delivery: ${q.delivery_time}` : null,
    q.payment_terms ? `Payment terms: ${q.payment_terms}` : null,
    q.incoterms ? `Incoterms: ${q.incoterms}` : null,
    q.valid_until ? `Validity: This quotation is valid until ${pdfDate(q.valid_until)}.` : null,
  ]
    .filter(Boolean)
    .join("\n");
  return buildDocumentPdf({
    title: "QUOTATION",
    company: d.company,
    logo: d.logo,
    meta: [
      ["Quotation no.", q.number],
      ["Date", pdfDate(q.issue_date)],
      ["Valid until", pdfDate(q.valid_until)],
      ["Your reference", q.client_ref],
      ["Our RFQ no.", q.rfq_number],
    ],
    partyLabel: "Quotation for",
    party: {
      name: d.client.name,
      lines: [
        d.client.address,
        [d.client.tin ? `TIN: ${d.client.tin}` : null, d.client.vrn ? `VRN: ${d.client.vrn}` : null].filter(Boolean).join("   "),
        q.contact_name ? `Attention: ${q.contact_name}` : null,
      ],
    },
    currency: q.currency,
    mode: "priced-discount",
    lines: d.lines,
    totals: {
      rows: [
        ...(q.discount_total > 0 ? ([["Discounts included", q.discount_total, true]] as [string, number, boolean][]) : []),
        ["Subtotal", q.subtotal],
        [`VAT ${Number(q.vat_rate)}%`, q.vat_amount],
      ],
      grandLabel: `TOTAL ${q.currency}`,
      grand: q.total,
    },
    blocks: [
      { title: "Commercial terms", body: commercial },
      { title: "Notes", body: q.notes },
      { title: "Terms and conditions", body: q.terms },
    ],
    showBank: true,
    signature: q.prepared_by ? `Prepared by: ${q.prepared_by}\nFor and on behalf of ${d.company.name}` : null,
    watermark: approved ? null : "DRAFT - NOT APPROVED",
  });
}
