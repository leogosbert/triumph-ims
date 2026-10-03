/**
 * How the master data template's columns map to database fields, and the
 * checks applied to each row before anything is saved.
 */
import { CURRENCIES } from "./lists";

type Kind = "text" | "number" | "integer" | "bool" | "currency";
type Col = { header: string; key: string; kind?: Kind; required?: boolean };

export const SUPPLIER_COLUMNS: Col[] = [
  { header: "Supplier ID", key: "code" },
  { header: "Supplier name", key: "name", required: true },
  { header: "Country", key: "country" },
  { header: "City", key: "city" },
  { header: "Contact person", key: "contact_person" },
  { header: "Email", key: "email" },
  { header: "Phone / WhatsApp", key: "phone" },
  { header: "Products supplied", key: "products_supplied" },
  { header: "Brands", key: "brands" },
  { header: "Currency", key: "currency", kind: "currency" },
  { header: "Payment terms", key: "payment_terms" },
  { header: "Incoterms", key: "incoterms" },
  { header: "Lead time (days)", key: "lead_time_days", kind: "integer" },
  { header: "Minimum order", key: "minimum_order" },
  { header: "TIN / tax no.", key: "tax_no" },
  { header: "Bank details received", key: "bank_details_received", kind: "bool" },
  { header: "Certificates held", key: "certificates" },
  { header: "Notes", key: "notes" },
];

export const CLIENT_COLUMNS: Col[] = [
  { header: "Client ID", key: "code" },
  { header: "Company name", key: "name", required: true },
  { header: "Industry", key: "industry" },
  { header: "TIN", key: "tin" },
  { header: "VRN", key: "vrn" },
  { header: "Registration no. (BRELA)", key: "registration_no" },
  { header: "Physical address", key: "address" },
  { header: "Region", key: "region" },
  { header: "Delivery sites", key: "delivery_sites" },
  { header: "Purchasing contact", key: "c_purchasing_name" },
  { header: "Purchasing email", key: "c_purchasing_email" },
  { header: "Purchasing phone / WhatsApp", key: "c_purchasing_phone" },
  { header: "Finance contact", key: "c_finance_name" },
  { header: "Finance email", key: "c_finance_email" },
  { header: "Finance phone", key: "c_finance_phone" },
  { header: "Technical contact", key: "c_technical_name" },
  { header: "Technical phone", key: "c_technical_phone" },
  { header: "Payment terms", key: "payment_terms" },
  { header: "Currency", key: "currency", kind: "currency" },
  { header: "Credit limit (TZS)", key: "credit_limit", kind: "number" },
  { header: "Tax status", key: "tax_status" },
  { header: "Our vendor status with them", key: "vendor_status" },
  { header: "Notes", key: "notes" },
];

export const PRODUCT_COLUMNS: Col[] = [
  { header: "SKU", key: "sku" },
  { header: "Product name", key: "name", required: true },
  { header: "Category", key: "category" },
  { header: "Subcategory", key: "subcategory" },
  { header: "Brand", key: "brand" },
  { header: "Manufacturer", key: "manufacturer" },
  { header: "Manufacturer part no.", key: "mfr_part_no" },
  { header: "Specification", key: "specification" },
  { header: "Unit", key: "unit" },
  { header: "Pack size", key: "pack_size" },
  { header: "Main supplier", key: "main_supplier" },
  { header: "Selling price (TZS)", key: "selling_price", kind: "number" },
  { header: "Last cost (TZS)", key: "last_cost", kind: "number" },
  { header: "Reorder level", key: "reorder_level", kind: "number" },
  { header: "Hazardous", key: "hazardous", kind: "bool" },
  { header: "UN no.", key: "un_number" },
  { header: "CAS no.", key: "cas_number" },
  { header: "Shelf life (months)", key: "shelf_life_months", kind: "integer" },
  { header: "Warranty (months)", key: "warranty_months", kind: "integer" },
  { header: "SDS on file", key: "sds_on_file", kind: "bool" },
  { header: "Country of origin", key: "country_of_origin" },
  { header: "Notes", key: "notes" },
];

export type Cell = string | number | boolean | Date | null;
export type Problem = { sheet: string; row: number; message: string };
export type Record_ = Record<string, unknown>;

const norm = (s: unknown) =>
  String(s ?? "")
    .replace(/\*/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function cellText(v: Cell): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).trim();
}

/** Converts one sheet's rows (first row = headings) into records, collecting problems. */
export function mapSheet(sheet: string, rows: Cell[][], columns: Col[], idKey: "code" | "sku") {
  const problems: Problem[] = [];
  const records: Record_[] = [];
  if (rows.length === 0) return { records, problems };

  const headers = rows[0].map(norm);
  const index = new Map<string, number>();
  for (const col of columns) {
    const i = headers.indexOf(norm(col.header));
    if (i >= 0) index.set(col.key, i);
  }
  const nameCol = columns.find((c) => c.required)!;
  if (!index.has(nameCol.key)) {
    problems.push({ sheet, row: 1, message: `Column "${nameCol.header}" was not found in the first row.` });
    return { records, problems };
  }

  const seen = new Set<string>();
  rows.slice(1).forEach((row, i) => {
    const rowNo = i + 2;
    const texts = row.map(cellText);
    if (texts.every((t) => t === "")) return; // empty row
    const name = texts[index.get(nameCol.key)!] ?? "";
    if (/\(example row\)/i.test(name)) return; // the template's grey example
    // Rows that only carry a formula result (like the margin column) are skipped too.
    const meaningful = columns.some((c) => (texts[index.get(c.key) ?? -1] ?? "") !== "");
    if (!meaningful) return;

    const rec: Record_ = {};
    for (const col of columns) {
      const i2 = index.get(col.key);
      if (i2 === undefined) continue;
      const raw = row[i2] ?? null;
      const text = cellText(raw);
      if (text === "") {
        if (col.required) problems.push({ sheet, row: rowNo, message: `${col.header} is empty.` });
        continue;
      }
      switch (col.kind) {
        case "number":
        case "integer": {
          const n = typeof raw === "number" ? raw : Number(text.replace(/[,\s]/g, "").replace(/^(TZS|USD)/i, ""));
          if (!Number.isFinite(n) || n < 0) {
            problems.push({ sheet, row: rowNo, message: `${col.header} "${text}" is not a valid number.` });
          } else if (col.kind === "integer" && !Number.isInteger(n)) {
            problems.push({ sheet, row: rowNo, message: `${col.header} must be a whole number.` });
          } else rec[col.key] = n;
          break;
        }
        case "bool": {
          const t = text.toLowerCase();
          if (["yes", "y", "true", "1"].includes(t)) rec[col.key] = true;
          else if (["no", "n", "false", "0"].includes(t)) rec[col.key] = false;
          else problems.push({ sheet, row: rowNo, message: `${col.header} should be Yes or No.` });
          break;
        }
        case "currency": {
          const c = text.toUpperCase();
          if (!/^[A-Z]{3}$/.test(c))
            problems.push({ sheet, row: rowNo, message: `Currency "${text}" should be a 3-letter code like ${CURRENCIES.slice(0, 2).join(" or ")}.` });
          else rec[col.key] = c;
          break;
        }
        default:
          rec[col.key] = col.key.endsWith("email") ? text.toLowerCase() : text;
      }
    }

    const id = String(rec[idKey] ?? "");
    if (id) {
      if (seen.has(id.toLowerCase()))
        problems.push({ sheet, row: rowNo, message: `${idKey === "sku" ? "SKU" : "ID"} "${id}" appears more than once.` });
      seen.add(id.toLowerCase());
    }
    if (name.length > 0 && name.length < 2) problems.push({ sheet, row: rowNo, message: "Name is too short." });
    records.push(rec);
  });
  return { records, problems };
}

/** Folds the template's contact columns into a contacts list. */
export function withContacts(rec: Record_): Record_ {
  const out: Record_ = {};
  const contacts: Record_[] = [];
  for (const kind of ["purchasing", "finance", "technical"]) {
    const c = {
      kind,
      name: rec[`c_${kind}_name`] ?? "",
      email: rec[`c_${kind}_email`] ?? "",
      phone: rec[`c_${kind}_phone`] ?? "",
    };
    if (c.name || c.email || c.phone) contacts.push(c);
  }
  for (const [k, v] of Object.entries(rec)) if (!k.startsWith("c_")) out[k] = v;
  out.contacts = contacts;
  return out;
}
