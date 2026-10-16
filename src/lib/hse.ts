/** Health & safety and quality lists (client-safe). English labels are keys; screens translate them with tr(). */

export const INCIDENT_KINDS: Record<string, string> = {
  injury: "Injury",
  near_miss: "Near miss",
  property_damage: "Property damage",
  environmental: "Environmental",
  vehicle: "Vehicle",
  fire: "Fire",
  other: "Other",
};

export const SEVERITIES: Record<string, { label: string; tone: string; hint: string }> = {
  low: { label: "Low", tone: "ok", hint: "No one hurt, little or no damage." },
  medium: { label: "Medium", tone: "warn", hint: "First aid, or damage that needs a repair." },
  high: { label: "High", tone: "bad", hint: "Someone needed a doctor or lost time, or serious damage." },
  critical: { label: "Critical", tone: "bad", hint: "Life-threatening, hospital stay, fire or major loss." },
};

export const INCIDENT_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "warn" },
  investigating: { label: "Investigating", tone: "info" },
  closed: { label: "Closed", tone: "off" },
};

export const INSPECTION_KINDS: Record<string, string> = {
  site: "Site",
  vehicle: "Vehicle",
  equipment: "Equipment",
  ppe: "PPE",
  fire: "Fire",
  toolbox_talk: "Toolbox talk",
  other: "Other",
};

export const INSPECTION_RESULTS: Record<string, { label: string; tone: string }> = {
  pass: { label: "Pass", tone: "ok" },
  actions_needed: { label: "Actions needed", tone: "warn" },
  fail: { label: "Fail", tone: "bad" },
};

export const NCR_SOURCES: Record<string, string> = {
  supplier: "Supplier",
  client_complaint: "Client complaint",
  internal: "Internal",
  audit: "Audit",
  other: "Other",
};

export const NCR_DISPOSITIONS: Record<string, string> = {
  return_to_supplier: "Return to supplier",
  replace: "Replace",
  rework: "Rework",
  use_as_is: "Use as is",
  scrap: "Scrap",
  credit_note: "Credit note",
  other: "Other",
};

export const NCR_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "warn" },
  action: { label: "Actions in progress", tone: "info" },
  closed: { label: "Closed", tone: "off" },
};

export const ACTION_STATUS: Record<string, { label: string; tone: string }> = {
  open: { label: "Open", tone: "warn" },
  done: { label: "Done", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "off" },
};

export type SourceKind = "incident" | "inspection" | "ncr";

/** Where a corrective action's record lives. */
export function sourcePath(kind: string, id: string) {
  return kind === "ncr" ? `/quality/${id}` : kind === "inspection" ? `/hse/inspections/${id}` : `/hse/${id}`;
}

export const SOURCE_KIND_LABEL: Record<string, string> = { incident: "Incident", inspection: "Inspection", ncr: "NCR" };

/** Database messages with a number in them become one sentence that can be translated. */
export function hseError(message: string | undefined | null): string {
  const m = message ?? "";
  if (/^Finish or cancel the \d+ open action/.test(m)) return "Finish or cancel the open actions first.";
  if (/hse_incidents_title_check|quality_ncrs_title_check/.test(m)) return "The title must be 3 to 160 characters.";
  if (/hse_incidents_description_check|quality_ncrs_description_check/.test(m)) return "Say what happened (at least 3 characters).";
  if (/corrective_actions_action_check/.test(m)) return "Describe the action (3 to 1000 characters).";
  if (/foreign key/i.test(m)) return "One of the linked records was not found.";
  return m;
}

export type Option = { id: string; label: string };

/** Keeps the saved value selectable even when it is no longer in the recent list. */
export function withCurrent(options: Option[], id: string | null | undefined, label: string | null | undefined): Option[] {
  if (!id || options.some((o) => o.id === id)) return options;
  return [{ id, label: label || "—" }, ...options];
}

export type Incident = {
  id: string;
  number: string;
  occurred_at: string;
  site: string | null;
  kind: string;
  severity: string;
  title: string;
  description: string;
  people_involved: string | null;
  employee_id: string | null;
  client_id: string | null;
  project_id: string | null;
  job_id: string | null;
  vehicle_id: string | null;
  immediate_action: string | null;
  root_cause: string | null;
  lost_days: number;
  reportable: boolean;
  status: string;
  closed_by: string | null;
  closed_at: string | null;
  reported_by: string;
  created_at: string;
};

export type Inspection = {
  id: string;
  number: string;
  inspected_on: string;
  kind: string;
  site: string | null;
  vehicle_id: string | null;
  project_id: string | null;
  job_id: string | null;
  topic: string | null;
  result: string;
  findings: string | null;
  attendees: string | null;
  attendee_count: number | null;
  inspector_id: string;
  created_at: string;
};

export type Ncr = {
  id: string;
  number: string;
  raised_on: string;
  source: string;
  title: string;
  description: string;
  supplier_id: string | null;
  client_id: string | null;
  product_id: string | null;
  purchase_order_id: string | null;
  delivery_id: string | null;
  quantity_affected: number | null;
  disposition: string | null;
  root_cause: string | null;
  cost: number;
  status: string;
  closed_by: string | null;
  closed_at: string | null;
  raised_by: string;
  created_at: string;
};

export type CorrectiveAction = {
  id: string;
  source_kind: string;
  source_id: string;
  action: string;
  owner_id: string | null;
  due_on: string | null;
  status: string;
  done_note: string | null;
  done_by: string | null;
  done_at: string | null;
  created_at: string;
};
