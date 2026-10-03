import { buildDocumentPdf, pdfDate, type DocCompany, type DocLine } from "./document";

type Logo = { bytes: Uint8Array; type: "png" | "jpg" } | null;
type Supplier = {
  name: string;
  city: string | null;
  country: string | null;
  contact_person: string | null;
  email: string | null;
  phone: string | null;
  tax_no: string | null;
};

export type PoPdfData = {
  company: DocCompany;
  logo: Logo;
  supplier: Supplier;
  po: {
    number: string;
    status: string;
    order_date: string;
    expected_date: string | null;
    supplier_ref: string | null;
    client_ref: string | null;
    currency: string;
    delivery_location: string | null;
    payment_terms: string | null;
    incoterms: string | null;
    shipping_instructions: string | null;
    notes: string | null;
    terms: string | null;
    freight: number;
    vat_rate: number;
    subtotal: number;
    vat_amount: number;
    total: number;
    ordered_by: string | null;
    approved_by: string | null;
  };
  lines: DocLine[];
};

function supplierLines(s: Supplier) {
  return [
    [s.city, s.country].filter(Boolean).join(", "),
    s.contact_person ? `Attention: ${s.contact_person}` : null,
    [s.phone, s.email].filter(Boolean).join("  |  "),
    s.tax_no ? `TIN / tax no.: ${s.tax_no}` : null,
  ];
}

export function buildPurchaseOrderPdf(d: PoPdfData) {
  const p = d.po;
  const approved = ["approved", "sent", "confirmed", "partially_received", "received", "closed"].includes(p.status);
  const delivery = [
    `Deliver to: ${p.delivery_location || d.company.address || d.company.name}`,
    p.expected_date ? `Required by: ${pdfDate(p.expected_date)}` : null,
    p.payment_terms ? `Payment terms: ${p.payment_terms}` : null,
    p.incoterms ? `Incoterms: ${p.incoterms}` : null,
  ]
    .filter(Boolean)
    .join("\n");
  const signature = [
    p.ordered_by ? `Ordered by: ${p.ordered_by}` : null,
    p.approved_by ? `Approved by: ${p.approved_by}` : null,
    `For and on behalf of ${d.company.name}`,
  ]
    .filter(Boolean)
    .join("\n");
  return buildDocumentPdf({
    title: "PURCHASE ORDER",
    company: d.company,
    logo: d.logo,
    meta: [
      ["PO no.", p.number],
      ["Date", pdfDate(p.order_date)],
      ["Required by", pdfDate(p.expected_date)],
      ["Your reference", p.supplier_ref],
      ["Client order", p.client_ref],
    ],
    partyLabel: "Supplier",
    party: { name: d.supplier.name, lines: supplierLines(d.supplier) },
    currency: p.currency,
    mode: "priced",
    lines: d.lines,
    totals: {
      rows: [
        ["Subtotal", p.subtotal],
        ...(p.freight > 0 ? ([["Freight", p.freight]] as [string, number][]) : []),
        [`VAT ${Number(p.vat_rate)}%`, p.vat_amount],
      ],
      grandLabel: `TOTAL ${p.currency}`,
      grand: p.total,
    },
    blocks: [
      { title: "Delivery and payment", body: delivery },
      { title: "Shipping instructions", body: p.shipping_instructions },
      { title: "Notes", body: p.notes },
      {
        title: "Terms",
        body:
          p.terms ||
          "Please confirm this order, its prices and the delivery date in writing. Quote our PO number on your delivery note and invoice. Certificates (CoA/SDS) must accompany chemical and lubricant deliveries.",
      },
    ],
    signature,
    watermark: approved ? null : "DRAFT - NOT APPROVED",
  });
}

export type SrfqPdfData = {
  company: DocCompany;
  logo: Logo;
  supplier: Supplier | null;
  rfq: { number: string; date: string; due_on: string | null; delivery_location: string | null; notes: string | null; contact: string | null };
  lines: DocLine[];
};

export function buildSupplierRfqPdf(d: SrfqPdfData) {
  const r = d.rfq;
  const ask = [
    "Please quote your best price for each item, and state:",
    "* currency, unit price and any minimum order quantity",
    "* delivery lead time and validity of your offer",
    "* payment terms and Incoterms (place of delivery)",
    "* brand / manufacturer offered, and whether certificates (CoA, SDS) are included",
    r.due_on ? `Please reply by ${pdfDate(r.due_on)}, quoting our reference ${r.number}.` : `Please quote our reference ${r.number} in your reply.`,
  ].join("\n");
  return buildDocumentPdf({
    title: "REQUEST FOR QUOTATION",
    company: d.company,
    logo: d.logo,
    meta: [
      ["Reference", r.number],
      ["Date", pdfDate(r.date)],
      ["Reply by", pdfDate(r.due_on)],
    ],
    partyLabel: "To",
    party: d.supplier ? { name: d.supplier.name, lines: supplierLines(d.supplier) } : { name: "Our valued suppliers", lines: [] },
    currency: "",
    mode: "unpriced",
    lines: d.lines,
    blocks: [
      { title: "What we need from you", body: ask },
      { title: "Delivery to", body: r.delivery_location || d.company.address },
      { title: "Notes", body: r.notes },
    ],
    signature: r.contact ? `Contact: ${r.contact}\nFor and on behalf of ${d.company.name}` : `For and on behalf of ${d.company.name}`,
  });
}
