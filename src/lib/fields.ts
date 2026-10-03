import { CATEGORIES, CURRENCIES, INCOTERMS, INDUSTRIES, PAYMENT_TERMS, TAX_STATUSES, UNITS, VENDOR_STATUSES } from "./lists";

export type FieldType = "text" | "textarea" | "email" | "tel" | "money" | "number" | "integer" | "select" | "bool";

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  options?: readonly string[];
  required?: boolean;
  hint?: string;
  wide?: boolean;
};

export type Section = { title: string; fields: FieldDef[] };

export const CLIENT_SECTIONS: Section[] = [
  {
    title: "Client",
    fields: [
      { key: "name", label: "Company name", type: "text", required: true, wide: true },
      { key: "code", label: "Client ID", type: "text", hint: "leave blank to number automatically" },
      { key: "industry", label: "Industry", type: "select", options: INDUSTRIES },
      { key: "tin", label: "TIN", type: "text" },
      { key: "vrn", label: "VRN", type: "text" },
      { key: "registration_no", label: "Registration no. (BRELA)", type: "text" },
    ],
  },
  {
    title: "Location",
    fields: [
      { key: "address", label: "Physical address", type: "textarea", wide: true },
      { key: "region", label: "Region", type: "text" },
      { key: "delivery_sites", label: "Delivery sites", type: "textarea", wide: true },
    ],
  },
  {
    title: "Terms",
    fields: [
      { key: "payment_terms", label: "Payment terms", type: "select", options: PAYMENT_TERMS },
      { key: "currency", label: "Currency", type: "select", options: CURRENCIES, required: true },
      { key: "credit_limit", label: "Credit limit (TZS)", type: "money", hint: "management or finance only" },
      { key: "tax_status", label: "Tax status", type: "select", options: TAX_STATUSES },
      { key: "vendor_status", label: "Our vendor status with them", type: "select", options: VENDOR_STATUSES },
    ],
  },
  { title: "Notes", fields: [{ key: "notes", label: "Notes", type: "textarea", wide: true }] },
];

export const SUPPLIER_SECTIONS: Section[] = [
  {
    title: "Supplier",
    fields: [
      { key: "name", label: "Supplier name", type: "text", required: true, wide: true },
      { key: "code", label: "Supplier ID", type: "text", hint: "leave blank to number automatically" },
      { key: "country", label: "Country", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "tax_no", label: "TIN / tax no.", type: "text" },
    ],
  },
  {
    title: "Contact",
    fields: [
      { key: "contact_person", label: "Contact person", type: "text" },
      { key: "email", label: "Email", type: "email" },
      { key: "phone", label: "Phone / WhatsApp", type: "tel" },
    ],
  },
  {
    title: "What they supply",
    fields: [
      { key: "products_supplied", label: "Products supplied", type: "textarea", wide: true },
      { key: "brands", label: "Brands", type: "text" },
      { key: "certificates", label: "Certificates held", type: "text" },
    ],
  },
  {
    title: "Terms",
    fields: [
      { key: "currency", label: "Currency", type: "select", options: CURRENCIES, required: true },
      { key: "payment_terms", label: "Payment terms", type: "select", options: PAYMENT_TERMS },
      { key: "incoterms", label: "Incoterms", type: "select", options: INCOTERMS },
      { key: "lead_time_days", label: "Lead time (days)", type: "integer" },
      { key: "minimum_order", label: "Minimum order", type: "text" },
      { key: "bank_details_received", label: "Bank details received", type: "bool" },
    ],
  },
  { title: "Notes", fields: [{ key: "notes", label: "Notes", type: "textarea", wide: true }] },
];

export const PRODUCT_SECTIONS: Section[] = [
  {
    title: "Product",
    fields: [
      { key: "name", label: "Product name", type: "text", required: true, wide: true },
      { key: "sku", label: "SKU", type: "text", hint: "leave blank to number automatically" },
      { key: "category", label: "Category", type: "select", options: CATEGORIES },
      { key: "subcategory", label: "Subcategory", type: "text" },
      { key: "brand", label: "Brand", type: "text" },
      { key: "manufacturer", label: "Manufacturer", type: "text" },
      { key: "mfr_part_no", label: "Manufacturer part no.", type: "text" },
      { key: "specification", label: "Specification", type: "textarea", wide: true },
    ],
  },
  {
    title: "Selling",
    fields: [
      { key: "unit", label: "Unit", type: "select", options: UNITS, required: true },
      { key: "pack_size", label: "Pack size", type: "text" },
      { key: "selling_price", label: "Selling price (TZS)", type: "money" },
      { key: "reorder_level", label: "Reorder level", type: "number" },
    ],
  },
  {
    title: "Safety & compliance",
    fields: [
      { key: "hazardous", label: "Hazardous", type: "bool" },
      { key: "un_number", label: "UN no.", type: "text" },
      { key: "cas_number", label: "CAS no.", type: "text" },
      { key: "sds_on_file", label: "SDS on file", type: "bool" },
      { key: "shelf_life_months", label: "Shelf life (months)", type: "integer" },
      { key: "warranty_months", label: "Warranty (months)", type: "integer" },
      { key: "country_of_origin", label: "Country of origin", type: "text" },
    ],
  },
  { title: "Notes", fields: [{ key: "notes", label: "Notes", type: "textarea", wide: true }] },
];

/** Turns text like "1,890,000" or "1 890 000.50" into a number. */
export function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, "").replace(/^TZS|^USD/i, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : NaN;
}

/** Reads a submitted form using the field definitions. Empty fields become null. */
export function parseSections(form: FormData, sections: Section[]): { values: Record<string, unknown>; error?: string } {
  const values: Record<string, unknown> = {};
  for (const section of sections) {
    for (const f of section.fields) {
      if (!form.has(f.key)) continue; // field not shown (e.g. disabled for this role)
      const raw = String(form.get(f.key) ?? "").trim();
      if (f.required && raw === "") return { values, error: `${f.label} is required.` };
      switch (f.type) {
        case "money":
        case "number":
        case "integer": {
          const n = toNumber(raw);
          if (Number.isNaN(n)) return { values, error: `${f.label} must be a number.` };
          if (n !== null && n < 0) return { values, error: `${f.label} cannot be negative.` };
          if (f.type === "integer" && n !== null && !Number.isInteger(n))
            return { values, error: `${f.label} must be a whole number.` };
          values[f.key] = f.key === "credit_limit" ? (n ?? 0) : n;
          break;
        }
        case "bool":
          values[f.key] = raw === "true";
          break;
        case "email":
          values[f.key] = raw === "" ? null : raw.toLowerCase();
          break;
        default:
          values[f.key] = raw === "" ? (f.key === "code" || f.key === "sku" ? "" : null) : raw;
      }
    }
  }
  return { values };
}
