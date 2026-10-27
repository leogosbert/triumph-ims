/** Shapes returned by the portal_* database functions (see 20261027000201_portal.sql). */

export type Party = "client" | "supplier";

export type PortalCompany = {
  id: string;
  name: string;
  legal_name: string | null;
  logo_path: string | null;
  primary_color: string;
  accent_color: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  website: string | null;
  base_currency: string;
};

export type PortalMe = {
  account: { id: string; party: Party; name: string; email: string; position: string | null; party_id: string; party_name: string | null };
  company: PortalCompany;
  counts: Record<string, number | boolean>;
};

export type PortalAccountRow = {
  id: string;
  party: Party;
  name: string;
  email: string;
  company_id: string;
  company: string;
  logo_path: string | null;
  primary_color: string;
  accent_color: string;
  party_name: string | null;
};

export type QuoteRow = {
  id: string;
  number: string;
  status: string;
  issue_date: string;
  valid_until: string | null;
  currency: string;
  total: number;
  client_ref: string | null;
  expired: boolean;
  decided_at: string | null;
};

export type QuoteLine = { line_no: number; description: string; quantity: number; unit: string; unit_price: number; discount_pct: number; line_total: number };

export type QuoteDecision = {
  decision: "accepted" | "declined";
  signer_name: string;
  signer_position: string | null;
  signature_kind: "typed" | "drawn" | null;
  signature_text: string | null;
  signature_image: string | null;
  reason: string | null;
  client_po_ref: string | null;
  created_at: string;
};

export type QuoteDetail = QuoteRow & {
  contact_name: string | null;
  delivery_time: string | null;
  payment_terms: string | null;
  incoterms: string | null;
  vat_rate: number;
  subtotal: number;
  discount_total: number;
  vat_amount: number;
  notes: string | null;
  terms: string | null;
  can_decide: boolean;
  lines: QuoteLine[];
  decision: QuoteDecision | null;
};

export type ProgressStage = { key: string; label: string; done: boolean };
export type Progress = {
  status: "in_progress" | "completed" | "rejected" | "cancelled" | "superseded";
  stages: ProgressStage[];
  done: number;
  total: number;
  percent: number;
  current: ProgressStage | null;
  next: ProgressStage | null;
} | null;

export type DeliveryRow = {
  id: string;
  number: string;
  status: "dispatched" | "delivered" | "failed" | "draft" | "cancelled";
  planned_date: string | null;
  dispatched_at: string | null;
  delivered_at: string | null;
  delivery_site: string | null;
  received_by_name: string | null;
  quotation_id?: string | null;
  vehicle?: string | null;
  pod_notes?: string | null;
  failed_reason?: string | null;
  has_signature?: boolean;
  has_photo?: boolean;
  lines?: { description: string; quantity: number; unit: string }[];
};

export type OrderRow = {
  id: string;
  number: string;
  client_ref: string | null;
  issue_date: string;
  decided_at: string | null;
  currency: string;
  total: number;
  progress: Progress;
};

export type InvoiceRow = {
  id: string;
  number: string;
  status: "issued" | "partly_paid" | "paid";
  issue_date: string | null;
  due_date: string | null;
  currency: string;
  total: number;
  amount_paid: number;
  balance: number;
  client_ref?: string | null;
  days_overdue?: number;
  quotation_number?: string | null;
};

export type OrderDetail = OrderRow & {
  delivery_time: string | null;
  lines: { line_no: number; description: string; quantity: number; unit: string }[];
  deliveries: DeliveryRow[];
  invoices: InvoiceRow[];
};

export type SharedDoc = {
  id: string;
  title: string;
  kind: string;
  reference: string | null;
  issued_on: string | null;
  expires_on: string | null;
  file_name: string | null;
  file_type: string | null;
  file_size: number | null;
  shared_at: string;
};

export type PortalMessage = { id: string; direction: "in" | "out"; from_name: string | null; subject: string | null; text: string | null; created_at: string };

export type RfqRow = {
  id: string;
  number: string;
  title: string | null;
  due_on: string | null;
  delivery_location: string | null;
  rfq_status: "open" | "awarded" | "cancelled";
  status: "invited" | "quoted" | "declined";
  received_on: string | null;
  valid_until: string | null;
  currency: string;
  awarded_to_you: boolean;
  lines: number;
};

export type RfqDetail = Omit<RfqRow, "lines"> & {
  notes: string | null;
  can_answer: boolean;
  lead_time_days: number | null;
  payment_terms: string | null;
  incoterms: string | null;
  freight: number;
  supplier_ref: string | null;
  answer_notes: string | null;
  lines: { id: string; line_no: number; description: string; quantity: number; unit: string; unit_price: number | null; notes: string | null }[];
  files: { id: string; file_name: string; created_at: string }[];
};

export type PoRow = {
  id: string;
  number: string;
  status: string;
  order_date: string;
  expected_date: string | null;
  currency: string;
  total: number;
  supplier_ref: string | null;
  confirmed_at: string | null;
};

export type Submission = {
  id: string;
  kind: "invoice" | "delivery_note";
  status: "submitted" | "billed" | "accepted" | "rejected";
  po_number?: string | null;
  supplier_invoice_no: string | null;
  reference?: string | null;
  doc_date?: string;
  due_date?: string | null;
  currency: string;
  total: number;
  review_note?: string | null;
  reviewed_at?: string | null;
  created_at: string;
  files?: { id: string; file_name: string }[];
};

export type PoDetail = PoRow & {
  delivery_location: string | null;
  payment_terms: string | null;
  incoterms: string | null;
  shipping_instructions: string | null;
  terms: string | null;
  freight: number;
  vat_rate: number;
  subtotal: number;
  vat_amount: number;
  can_confirm: boolean;
  lines: { line_no: number; description: string; quantity: number; unit: string; unit_price: number; line_total: number; received_qty: number }[];
  submissions: Submission[];
};

export type SupplierProfile = {
  name: string;
  tax_no: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  certificates: string | null;
  currency: string;
  bank: { bank_name: string; account_name: string; account_number: string; branch: string | null; swift_code: string | null; currency: string; approved_at: string } | null;
  pending: { id: string; bank_name: string; account_name: string; account_number: string; currency: string; requested_at: string } | null;
  last_decision: { status: "approved" | "rejected"; note: string | null; decided_at: string } | null;
  files: { id: string; purpose: string; title: string | null; reference: string | null; expires_on: string | null; file_name: string; created_at: string }[];
};
