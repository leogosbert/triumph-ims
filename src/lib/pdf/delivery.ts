import { buildDocumentPdf, pdfDate, type DocCompany, type DocLine } from "./document";

export type DeliveryPdfData = {
  company: DocCompany;
  logo: { bytes: Uint8Array; type: "png" | "jpg" } | null;
  delivery: {
    number: string;
    status: string;
    planned_date: string | null;
    dispatched_at: string | null;
    client_ref: string | null;
    quotation_no: string | null;
    delivery_site: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    vehicle: string | null;
    driver: string | null;
    notes: string | null;
    received_by_name: string | null;
    delivered_at: string | null;
    gps: string | null;
    pod_notes: string | null;
  };
  client: { name: string; address: string | null; tin: string | null };
  store: string;
  lines: (DocLine & { batches?: string | null })[];
  signature: { bytes: Uint8Array; type: "png" | "jpg" } | null;
};

function when(iso: string | null) {
  if (!iso) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Dar_es_Salaam",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function buildDeliveryNotePdf(d: DeliveryPdfData) {
  const x = d.delivery;
  const delivered = x.status === "delivered";
  return buildDocumentPdf({
    title: delivered ? "PROOF OF DELIVERY" : "DELIVERY NOTE",
    company: d.company,
    logo: d.logo,
    meta: [
      ["Delivery note", x.number],
      ["Date", pdfDate(x.dispatched_at ?? x.planned_date ?? new Date().toISOString())],
      ["Your order", x.client_ref],
      ["Our quotation", x.quotation_no],
      ["Vehicle", x.vehicle],
    ],
    partyLabel: "Deliver to",
    party: {
      name: d.client.name,
      lines: [
        x.delivery_site ?? d.client.address,
        [x.contact_name ? `Contact: ${x.contact_name}` : null, x.contact_phone].filter(Boolean).join("  "),
        d.client.tin ? `TIN: ${d.client.tin}` : null,
      ],
    },
    currency: "",
    mode: "quantities",
    lines: d.lines.map((l) => ({
      ...l,
      description: l.batches ? `${l.description}\nBatch: ${l.batches}` : l.description,
    })),
    blocks: [
      { title: "Notes", body: x.notes },
      { title: "Delivery remarks", body: x.pod_notes },
      { title: "From", body: `${d.store}${x.driver ? ` · Driver: ${x.driver}` : ""}` },
    ],
    signoff: {
      deliveredBy: x.driver,
      receivedBy: delivered ? x.received_by_name : null,
      when: delivered ? `Delivered ${when(x.delivered_at)}` : null,
      gps: delivered ? x.gps : null,
      signature: delivered ? d.signature : null,
    },
  });
}
