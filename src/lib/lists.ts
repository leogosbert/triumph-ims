/** Drop-down lists, kept identical to the master data template's "Lists" tab. */
export const INDUSTRIES = [
  "Mining",
  "Oil & Gas",
  "Cement",
  "Sugar",
  "Brewing",
  "Food processing",
  "Manufacturing",
  "Agriculture",
  "Construction",
  "Power generation",
  "Water treatment",
  "Government",
  "Healthcare",
  "Hospitality",
  "Logistics",
  "Chemicals",
  "Other",
];

export const PAYMENT_TERMS = [
  "Cash on delivery",
  "100% advance",
  "50% advance",
  "Net 7",
  "Net 15",
  "Net 30",
  "Net 45",
  "Net 60",
];

export const CURRENCIES = ["TZS", "USD", "EUR", "GBP", "ZAR", "KES"];

export const CATEGORIES = [
  "Chemicals",
  "Lubricants and oils",
  "Bearings",
  "Hoses and fittings",
  "Filters",
  "Mechanical spares",
  "Electrical",
  "Safety and PPE",
  "Consumables",
  "Other",
];

export const UNITS = ["pcs", "set", "drum", "pail", "litre", "kg", "bag", "m", "roll", "box", "carton"];

export const INCOTERMS = ["EXW", "FCA", "FOB", "CFR", "CIF", "CPT", "CIP", "DAP", "DPU", "DDP"];

export const TAX_STATUSES = ["VAT registered", "Not VAT registered", "Exempt", "Zero-rated"];

export const VENDOR_STATUSES = ["Approved vendor", "Registration in progress", "Not started"];

export const CONTACT_KINDS = [
  { value: "purchasing", label: "Purchasing" },
  { value: "finance", label: "Finance" },
  { value: "technical", label: "Technical" },
  { value: "other", label: "Other" },
] as const;
