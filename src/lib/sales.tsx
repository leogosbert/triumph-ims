export const RFQ_STATUS: Record<string, { label: string; tone: string }> = {
  new: { label: "New", tone: "info" },
  quoting: { label: "Quoting", tone: "warn" },
  quoted: { label: "Quoted", tone: "info" },
  won: { label: "Won", tone: "ok" },
  lost: { label: "Lost", tone: "off" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export const QUOTE_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft", tone: "off" },
  pending_approval: { label: "Waiting for approval", tone: "warn" },
  approved: { label: "Approved", tone: "info" },
  sent: { label: "Sent to client", tone: "info" },
  accepted: { label: "Accepted", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
  superseded: { label: "Replaced by revision", tone: "off" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export const RECEIVED_VIA = [
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone call" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "visit", label: "Site visit" },
  { value: "tender", label: "Tender" },
  { value: "other", label: "Other" },
];

export function quoteNo(q: { number: string; revision: number }) {
  return q.revision > 0 ? `${q.number}-R${q.revision}` : q.number;
}

export function StatusBadge({ map, status }: { map: Record<string, { label: string; tone: string }>; status: string }) {
  const s = map[status] ?? { label: status, tone: "off" };
  return <span className={`badge tone-${s.tone}`}>{s.label}</span>;
}

export function todayTz() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
}
