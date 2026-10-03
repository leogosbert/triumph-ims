// Builds a sample quotation PDF (used by the automatic checks to catch layout errors).
import { readFileSync, writeFileSync } from "node:fs";
import { buildPurchaseOrderPdf, buildSupplierRfqPdf } from "../src/lib/pdf/purchasing";
import { buildQuotationPdf } from "../src/lib/pdf/quotation";

const lines = Array.from({ length: 24 }, (_, i) => ({
  line_no: i + 1,
  description:
    i % 5 === 0
      ? "Hydraulic oil ISO VG 68, DIN 51524-2 HLP – Shell Tellus S2 M 68, supplied in 208 litre drums with batch CoA and SDS"
      : i % 3 === 0
        ? "SKF 6312-2RS1/C3 deep groove ball bearing"
        : "Oil filter element",
  sku: i % 2 === 0 ? `SKU-${1000 + i}` : null,
  quantity: (i % 4) + 1,
  unit: i % 5 === 0 ? "drum" : "pcs",
  unit_price: 125000 + i * 3500,
  discount_pct: i % 6 === 0 ? 5 : 0,
  line_total: 0,
}));
for (const l of lines) l.line_total = Math.round(l.quantity * l.unit_price * (1 - l.discount_pct / 100));
const subtotal = lines.reduce((s, l) => s + l.line_total, 0);
const gross = lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);

const company = {
      name: "TRIUMPH General Suppliers Ltd",
      legal_name: "TRIUMPH General Suppliers Limited",
      address: "Plot 45, Nyerere Road, P.O. Box 1234, Dar es Salaam, Tanzania",
      phone: "+255 700 000 000",
      email: "sales@triumphsuppliers.co.tz",
      website: "www.triumphsuppliers.co.tz",
      tin: "123-456-789",
      vrn: "40-012345-A",
      primary_color: "#1C4C9B",
      accent_color: "#123A7A",
      bank_details: null,
      document_footer: "TRIUMPH General Suppliers Ltd · Reliable supply for mining, oil & gas, cement and manufacturing",
};
const supplier = {
  name: "SA Bearings (Pty) Ltd",
  city: "Johannesburg",
  country: "South Africa",
  contact_person: "Pieter van Wyk",
  email: "sales@sabearings.co.za",
  phone: "+27 11 000 0000",
  tax_no: "4123456789",
};

async function main() {
  if (process.argv[2] === "po" || process.argv[2] === "srfq") {
    const logo = { bytes: new Uint8Array(readFileSync("public/icons/icon-192.png")), type: "png" as const };
    const few = lines.slice(0, 6).map((l) => ({ ...l, unit_price: l.unit_price / 2600, line_total: l.line_total / 2600 }));
    const sub = few.reduce((s, l) => s + l.line_total, 0);
    const bytes =
      process.argv[2] === "po"
        ? await buildPurchaseOrderPdf({
            company,
            logo,
            supplier,
            po: {
              number: "PO-2026-0003",
              status: "approved",
              order_date: "2026-10-06",
              expected_date: "2026-10-27",
              supplier_ref: "Q-77812",
              client_ref: "QT-2026-0007",
              currency: "USD",
              delivery_location: "TRIUMPH store, Plot 45 Nyerere Road, Dar es Salaam",
              payment_terms: "30% advance, 70% on delivery",
              incoterms: "CIF Dar es Salaam",
              shipping_instructions: "Ship by sea in one consignment. Mark cartons with PO number.",
              notes: null,
              terms: null,
              freight: 150,
              vat_rate: 0,
              subtotal: sub,
              vat_amount: 0,
              total: sub + 150,
              ordered_by: "Pat Procurement",
              approved_by: "Leo Mboyerwa",
            },
            lines: few,
          })
        : await buildSupplierRfqPdf({
            company,
            logo,
            supplier,
            rfq: {
              number: "SRFQ-2026-0004",
              date: "2026-10-06",
              due_on: "2026-10-09",
              delivery_location: "Geita Gold Mine, main stores",
              notes: "Equivalent brands acceptable if stated clearly.",
              contact: "Pat Procurement, +255 700 000 001",
            },
            lines: few,
          });
    writeFileSync(process.argv[3], bytes);
    console.log(`ok ${bytes.length} bytes`);
    return;
  }
  const bytes = await buildQuotationPdf({
    company: {
      name: "TRIUMPH General Suppliers Ltd",
      legal_name: "TRIUMPH General Suppliers Limited",
      address: "Plot 45, Nyerere Road, P.O. Box 1234, Dar es Salaam, Tanzania",
      phone: "+255 700 000 000",
      email: "sales@triumphsuppliers.co.tz",
      website: "www.triumphsuppliers.co.tz",
      tin: "123-456-789",
      vrn: "40-012345-A",
      primary_color: "#1C4C9B",
      accent_color: "#123A7A",
      bank_details: "CRDB Bank PLC, Azikiwe Branch\nAccount name: TRIUMPH General Suppliers Ltd\nTZS A/C: 0150 1234 5678 00 · USD A/C: 0250 1234 5678 00\nSWIFT: CORUTZTZ",
      document_footer: "TRIUMPH General Suppliers Ltd · Reliable supply for mining, oil & gas, cement and manufacturing",
    },
    logo: { bytes: new Uint8Array(readFileSync("public/icons/icon-192.png")), type: "png" },
    quote: {
      number: "QT-2026-0007-R1",
      status: process.argv[2] === "draft" ? "draft" : "approved",
      issue_date: "2026-10-05",
      valid_until: "2026-11-04",
      currency: "TZS",
      contact_name: "Asha Mwakyusa, Procurement Officer",
      client_ref: "PR-88231",
      rfq_number: "RFQ-2026-0012",
      delivery_time: "2–3 weeks after receipt of PO",
      payment_terms: "Net 30",
      incoterms: "DAP Geita",
      vat_rate: 18,
      subtotal,
      discount_total: gross - subtotal,
      vat_amount: Math.round(subtotal * 0.18),
      total: subtotal + Math.round(subtotal * 0.18),
      notes: "Prices include delivery to site. Batch certificates of analysis supplied with each delivery.",
      terms: "1. Prices are valid for the period stated above.\n2. Goods remain the property of TRIUMPH until paid in full.\n3. Claims for shortages must be made within 3 days of delivery.",
      prepared_by: "Leo Mboyerwa",
    },
    client: {
      name: "Geita Gold Mining Ltd",
      address: "P.O. Box 532, Geita, Tanzania",
      tin: "100-200-300",
      vrn: "40-000111-B",
    },
    lines,
  });
  writeFileSync(process.argv[3] ?? "sample-quotation.pdf", bytes);
  console.log(`ok ${bytes.length} bytes`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
