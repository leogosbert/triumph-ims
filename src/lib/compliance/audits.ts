import { requirement } from "./catalogue";
import type { ComplianceItem, Licence } from "./model";
import { addDays } from "./model";

/**
 * Inspection and audit packs: what each kind of visitor (TRA, a labour officer, OSHA, GCLA, a mine's vendor team…)
 * usually asks to see, built from the requirements catalogue plus records the app already keeps. Each line checks
 * itself against the company's checklist, licences register and documents library, so the page can say how ready
 * the file is. Mirrors the Cocozania "Documents & audits" design, adapted to a general supply company.
 * Guidance, not legal advice: inspectors can ask for more.
 */

/** Records kept in the app itself (not a requirement on the checklist). */
export type RecordKey = "invoices" | "payroll" | "sds" | "coa" | "insurance" | "contracts" | "tax_papers";

export const RECORDS: Record<RecordKey, { label: string; href: string; hint: string }> = {
  invoices: { label: "Sales invoices issued from the app", href: "/invoices", hint: "Every sale with its number, VAT and the client's TIN." },
  payroll: { label: "Payroll runs (PAYE, SDL, NSSF, WCF worked out)", href: "/payroll", hint: "One run for each month salaries were paid." },
  sds: { label: "Safety data sheets in the documents library", href: "/documents", hint: "One SDS for each chemical, oil or lubricant you sell or store." },
  coa: { label: "Certificates of analysis in the documents library", href: "/documents", hint: "From the manufacturer, for each batch where the client asks." },
  insurance: { label: "Insurance policies in the documents library", href: "/documents", hint: "Premises, stock, goods in transit, motor, public liability." },
  contracts: { label: "Client and supplier contracts in the documents library", href: "/contracts", hint: "Signed copies, with the dates they run." },
  tax_papers: { label: "Tax papers in the documents library", href: "/documents", hint: "Returns, payment slips (control numbers) and assessments." },
};

export type PackLine = { code: string } | { record: RecordKey };

export type AuditPack = {
  key: string;
  title: string;
  who: string;
  /** one or two sentences: what they look at and how to get ready */
  tip: string;
  lines: PackLine[];
  /** words for the search box */
  words: string;
};

const c = (...codes: string[]): PackLine[] => codes.map((code) => ({ code }));
const rec = (...keys: RecordKey[]): PackLine[] => keys.map((record) => ({ record }));

export const AUDIT_PACKS: AuditPack[] = [
  {
    key: "tra",
    title: "TRA tax audit",
    who: "TRA",
    tip: "TRA compares your returns with your books, bank statements, EFD receipts and the invoices of your clients and suppliers. Have every month's returns and payment slips in one file, and the reasons for any big difference.",
    lines: [
      ...c("TRA_TIN", "TRA_VAT_REGISTRATION", "TRA_EFD", "BOOKS_OF_ACCOUNT", "TRA_VAT_RETURN", "TRA_PAYE", "TRA_SDL", "TRA_WHT", "TRA_PROVISIONAL_TAX", "TRA_FINAL_RETURN", "AUDITED_ACCOUNTS", "TRA_TAX_CLEARANCE", "IMPORT_CUSTOMS"),
      ...rec("invoices", "payroll", "tax_papers"),
    ],
    words: "tra tax audit kodi ukaguzi vat paye efd returns books assessment",
  },
  {
    key: "labour",
    title: "Labour inspection",
    who: "Labour officer",
    tip: "The labour officer asks for written contracts, the staff register, pay records and the rules you have shown to staff. Foreign staff need their work and residence permits on file.",
    lines: [...c("EMPLOYMENT_CONTRACTS", "STAFF_REGISTER", "WORKPLACE_POLICIES", "WORK_PERMITS", "NSSF_REGISTRATION", "WCF_REGISTRATION"), ...rec("payroll")],
    words: "labour inspection afisa kazi employment contracts staff register permits",
  },
  {
    key: "social",
    title: "NSSF and WCF compliance check",
    who: "NSSF / WCF",
    tip: "They match the people on your payroll with the contributions paid each month. Keep the monthly schedules and the payment receipts together.",
    lines: [...c("NSSF_REGISTRATION", "NSSF_CONTRIBUTIONS", "WCF_REGISTRATION", "WCF_CONTRIBUTIONS", "STAFF_REGISTER"), ...rec("payroll")],
    words: "nssf wcf contributions social security compliance check",
  },
  {
    key: "osha",
    title: "OSHA workplace inspection",
    who: "OSHA",
    tip: "OSHA looks at the store and any workshop: registration, first aid, fire equipment, safe stacking, protective gear and how chemicals and oils are kept. Have the safety data sheets where the goods are stored.",
    lines: [...c("OSHA_REGISTRATION", "FIRE_CERTIFICATE", "HSE_QUALITY_POLICIES", "SDS_PRODUCT_DOCS", "WCF_REGISTRATION"), ...rec("sds")],
    words: "osha inspection safety workplace ppe first aid store",
  },
  {
    key: "fire",
    title: "Fire inspection",
    who: "Fire and Rescue Force",
    tip: "The fire officer checks extinguishers, exits and how flammable goods (oils, lubricants, solvents) are stored, then issues or renews the fire certificate.",
    lines: [...c("FIRE_CERTIFICATE", "TIRA_INSURANCE", "PREMISES_LEASE", "SDS_PRODUCT_DOCS"), ...rec("insurance")],
    words: "fire zimamoto inspection extinguisher certificate flammable",
  },
  {
    key: "gcla",
    title: "Chemicals inspection",
    who: "GCLA",
    tip: "GCLA checks that the company is registered for the chemicals it imports, stores or sells, that each chemical has a safety data sheet and correct labels, and that the store meets its rules.",
    lines: [...c("GCLA_CHEMICALS", "SDS_PRODUCT_DOCS", "OSHA_REGISTRATION", "FIRE_CERTIFICATE", "IMPORT_CUSTOMS"), ...rec("sds")],
    words: "gcla chemicals inspection kemikali sds labels store registration",
  },
  {
    key: "ewura",
    title: "Petroleum products check",
    who: "EWURA",
    tip: "If you sell or store fuel or other petroleum products, EWURA checks the licence, the storage and the records of what came in and went out. Lubricants may have their own rules: ask EWURA which apply.",
    lines: [...c("EWURA_PETROLEUM", "FIRE_CERTIFICATE", "NEMC_ENVIRONMENT", "SDS_PRODUCT_DOCS"), ...rec("sds")],
    words: "ewura petroleum fuel lubricants oil licence storage",
  },
  {
    key: "nemc",
    title: "Environmental inspection",
    who: "NEMC",
    tip: "NEMC asks about waste oil, empty drums, spills and chemical waste: who collects it and the papers that show it was disposed of properly.",
    lines: [...c("NEMC_ENVIRONMENT", "GCLA_CHEMICALS", "SDS_PRODUCT_DOCS")],
    words: "nemc environment mazingira waste oil spill disposal",
  },
  {
    key: "tbs",
    title: "Standards and weights check",
    who: "TBS / WMA",
    tip: "TBS and WMA check that goods meet the standard (marks, certificates of conformity for imports) and that scales and measures used to sell are verified.",
    lines: [...c("TBS_CERTIFICATION", "WMA_VERIFICATION", "SDS_PRODUCT_DOCS", "IMPORT_CUSTOMS"), ...rec("coa")],
    words: "tbs standards wma scales weights certificate conformity",
  },
  {
    key: "council",
    title: "Council licence inspection",
    who: "Municipal council",
    tip: "The council checks the business licence for each premises, the service levy and the signboard. They usually want to see the licence displayed.",
    lines: [...c("BUSINESS_LICENCE", "TAUSI_PORTAL", "SERVICE_LEVY", "SIGNBOARD_PERMIT", "FIRE_CERTIFICATE", "PREMISES_LEASE", "TRA_TAX_CLEARANCE")],
    words: "council halmashauri business licence leseni service levy signboard",
  },
  {
    key: "pdpc",
    title: "Data protection check",
    who: "PDPC",
    tip: "The PDPC checks that the company is registered as a data controller, keeps staff and client data safe and has someone responsible for it.",
    lines: [...c("PDPC_REGISTRATION", "WORKPLACE_POLICIES")],
    words: "pdpc data protection privacy personal data",
  },
  {
    key: "brela",
    title: "Company records (BRELA)",
    who: "BRELA / auditors",
    tip: "The registers, annual returns and minutes show who owns and runs the company. With four directors and shares not yet decided, record the decision in board minutes and file the change with BRELA.",
    lines: [...c("BRELA_INCORPORATION", "BRELA_MEMART", "BRELA_SHAREHOLDING", "BRELA_BENEFICIAL_OWNERS", "BRELA_REGISTERS", "BRELA_ANNUAL_RETURN", "BRELA_CHANGES", "AGM_MINUTES")],
    words: "brela company records registers annual return minutes shares directors beneficial owners",
  },
  {
    key: "mine",
    title: "Mining client vendor check",
    who: "Mines and their procurement teams",
    tip: "Mines check the company papers, tax clearance, local content registration, HSE policies and insurance before they add you as a vendor, and again each year. Keep one up-to-date pack ready to send.",
    lines: [
      ...c("BRELA_INCORPORATION", "BRELA_MEMART", "BRELA_BENEFICIAL_OWNERS", "TRA_TIN", "TRA_VAT_REGISTRATION", "TRA_TAX_CLEARANCE", "BUSINESS_LICENCE", "MINING_LOCAL_CONTENT", "CLIENT_VENDOR_REGISTRATION", "HSE_QUALITY_POLICIES", "TIRA_INSURANCE", "NSSF_REGISTRATION", "WCF_REGISTRATION", "SDS_PRODUCT_DOCS"),
      ...rec("insurance", "sds"),
    ],
    words: "mine mining vendor registration due diligence supplier local content",
  },
  {
    key: "oilgas",
    title: "Oil and gas client vendor check",
    who: "Oil and gas companies",
    tip: "Oil and gas buyers ask for local content registration with PURA, HSE policies, insurance and the usual company and tax papers.",
    lines: [...c("BRELA_INCORPORATION", "TRA_TIN", "TRA_TAX_CLEARANCE", "PURA_LOCAL_CONTENT", "CLIENT_VENDOR_REGISTRATION", "HSE_QUALITY_POLICIES", "TIRA_INSURANCE", "SDS_PRODUCT_DOCS"), ...rec("insurance")],
    words: "oil gas pura local content vendor registration supplier",
  },
  {
    key: "tender",
    title: "Government tender",
    who: "Public buyers (NeST)",
    tip: "Government tenders are run on NeST. The usual papers are the company registration, tax clearance, business licence, a power of attorney for the signer and audited accounts.",
    lines: [...c("PPRA_NEST", "TENDER_PACK", "POWER_OF_ATTORNEY", "BRELA_INCORPORATION", "BRELA_MEMART", "TRA_TIN", "TRA_TAX_CLEARANCE", "BUSINESS_LICENCE", "AUDITED_ACCOUNTS", "GPSA_FRAMEWORK")],
    words: "tender nest ppra government zabuni bid public procurement",
  },
  {
    key: "bank",
    title: "Bank loan or credit check",
    who: "Banks and big suppliers",
    tip: "Banks and suppliers giving credit ask for the company papers, accounts, bank statements and tax clearance, and the IDs of the directors.",
    lines: [...c("BRELA_INCORPORATION", "BRELA_MEMART", "BRELA_SHAREHOLDING", "BANK_ACCOUNT", "TRA_TIN", "TRA_TAX_CLEARANCE", "AUDITED_ACCOUNTS", "BOOKS_OF_ACCOUNT"), ...rec("contracts")],
    words: "bank loan credit overdraft supplier credit facility",
  },
];

export function auditPack(key: string | null | undefined): AuditPack | undefined {
  return AUDIT_PACKS.find((p) => p.key === key);
}

// ------------------------------------------------------------------ checking a pack

export type LineState = "ok" | "due" | "missing" | "na";

export const LINE_STATE: Record<LineState, { label: string; tone: string }> = {
  ok: { label: "Ready", tone: "ok" },
  due: { label: "Needs attention", tone: "warn" },
  missing: { label: "Missing", tone: "bad" },
  na: { label: "Not needed for us", tone: "off" },
};

export type PackData = {
  today: string;
  items: Map<string, Pick<ComplianceItem, "id" | "status" | "status_note">>;
  /** documents linked to each checklist item */
  docCount: Map<string, number>;
  /** licences by catalogue code (any status) */
  licences: Map<string, Pick<Licence, "id" | "name" | "status" | "licence_no" | "expires_on" | "remind_days">[]>;
  /** documents linked to each licence */
  licenceDocs: Map<string, number>;
  /** counts of the records kept in the app */
  records: Partial<Record<RecordKey, number>>;
};

export type CheckedLine = {
  line: PackLine;
  title: string;
  authority: string;
  state: LineState;
  detail: string;
  href: string;
  /** the code to mark "not needed", when it can be */
  code?: string;
};

/** Where the company stands on one line of a pack. */
export function checkLine(line: PackLine, d: PackData): CheckedLine {
  if ("record" in line) {
    const r = RECORDS[line.record];
    const n = d.records[line.record] ?? 0;
    return {
      line,
      title: r.label,
      authority: "In the app",
      state: n > 0 ? "ok" : "missing",
      detail: n > 0 ? `${n} kept in the app` : `None yet. ${r.hint}`,
      href: r.href,
    };
  }
  const req = requirement(line.code);
  const item = d.items.get(line.code);
  const title = req?.name ?? line.code;
  const authority = req?.authority ?? "";
  const base = { line, title, authority, code: line.code };
  if (item?.status === "not_applicable") {
    return { ...base, state: "na", detail: item.status_note ?? "Marked as not needed for us.", href: `/compliance/checklist/${item.id}` };
  }
  // A licence in the register decides for licences: the newest one counts.
  const lic = [...(d.licences.get(line.code) ?? [])].sort((a, b) => String(b.expires_on ?? "9999").localeCompare(String(a.expires_on ?? "9999")))[0];
  if (lic) {
    const href = `/compliance/licences/${lic.id}`;
    const no = lic.licence_no ? `${lic.licence_no}, ` : "";
    if (lic.status === "active") {
      if (lic.expires_on && lic.expires_on < d.today) return { ...base, state: "missing", detail: `${no}expired on ${lic.expires_on}. Renew it.`, href };
      if (lic.expires_on && lic.expires_on <= addDays(d.today, lic.remind_days || 60)) {
        return { ...base, state: "due", detail: `${no}expires on ${lic.expires_on}. Start the renewal now.`, href };
      }
      if (!(d.licenceDocs.get(lic.id) ?? 0)) return { ...base, state: "due", detail: `${no}active, but no copy uploaded.`, href };
      return { ...base, state: "ok", detail: `${no}active${lic.expires_on ? `, valid until ${lic.expires_on}` : ""}.`, href };
    }
    if (lic.status === "applied") return { ...base, state: "due", detail: "Applied, waiting for the authority.", href };
    if (lic.status === "expired" || lic.status === "suspended") return { ...base, state: "missing", detail: `The licence is ${lic.status}.`, href };
  }
  if (!item) {
    return { ...base, state: "missing", detail: "Not on your checklist yet.", href: `/compliance/guide?code=${encodeURIComponent(line.code)}` };
  }
  const href = `/compliance/checklist/${item.id}`;
  if (item.status === "done") {
    const needsCopy = req ? req.kind === "registration" || req.kind === "licence" : false;
    if (needsCopy && !(d.docCount.get(item.id) ?? 0)) return { ...base, state: "due", detail: "Done, but no copy uploaded.", href };
    return { ...base, state: "ok", detail: item.status_note ?? "Done.", href };
  }
  if (item.status === "in_progress") return { ...base, state: "due", detail: item.status_note ?? "In progress.", href };
  return { ...base, state: "missing", detail: "Not started.", href };
}

/** A pack checked line by line, with the share that is ready (lines marked not needed are left out). */
export function checkPack(pack: AuditPack, d: PackData): { lines: CheckedLine[]; ready: number; counted: number; pct: number } {
  const lines = pack.lines.map((l) => checkLine(l, d));
  const counted = lines.filter((l) => l.state !== "na").length;
  const ready = lines.filter((l) => l.state === "ok").length;
  return { lines, ready, counted, pct: counted ? Math.round((ready * 100) / counted) : 100 };
}
