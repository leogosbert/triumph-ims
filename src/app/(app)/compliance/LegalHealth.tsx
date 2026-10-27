import Link from "next/link";
import type { createClient } from "@/lib/supabase/server";
import { SubmitButton } from "@/components/SubmitButton";
import type { Company } from "@/lib/context";
import { COMPLIANCE_CATALOGUE } from "@/lib/compliance/catalogue";
import { addDays } from "@/lib/compliance/model";
import { changedRules, type LegalRules } from "@/lib/compliance/rules";
import { formatMoney } from "@/lib/money";
import { hasRole, type Role, type RoleSet } from "@/lib/roles";
import { tr } from "@/lib/tr";
import { addUsualLicences } from "./actions";

type Check = { tone: "ok" | "warn" | "bad" | "info"; title: string; detail: string; href?: string; action?: "licences" };

const LICENCE_CODES = new Set(COMPLIANCE_CATALOGUE.filter((r) => r.kind === "licence").map((r) => r.code));

/**
 * The legal health check on the overview (Cocozania's LegalHealth, for Triumph): VAT threshold from the invoices,
 * EFD receipts, TIN, data protection and licences missing from the register. Server component; reads only.
 */
export async function LegalHealth({
  supabase,
  company,
  role,
  isManager,
  rules,
  today,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  company: Company;
  role: RoleSet;
  isManager: boolean;
  rules: LegalRules;
  today: string;
}) {
  const seesSales = hasRole(role, "management", "finance", "sales");
  const [invRes, itemsRes, licRes] = await Promise.all([
    seesSales
      ? supabase
          .from("invoices")
          .select("issue_date, total, vat_amount, exchange_rate")
          .eq("company_id", company.id)
          .in("status", ["issued", "partly_paid", "paid"])
          .gte("issue_date", addDays(today, -365))
          .limit(20000)
      : Promise.resolve({ data: null, error: null }),
    supabase.from("compliance_items").select("id, code, status, licence_id").eq("company_id", company.id).not("code", "is", null).limit(1000),
    supabase.from("licences").select("catalogue_code, status").eq("company_id", company.id).limit(1000),
  ]);
  const items = (itemsRes.data ?? []) as { id: string; code: string; status: string; licence_id: string | null }[];
  const byCode = new Map(items.map((i) => [i.code, i]));
  const licences = (licRes.data ?? []) as { catalogue_code: string | null; status: string }[];
  const licenceActive = (code: string) => licences.some((l) => l.catalogue_code === code && l.status === "active");
  const done = (code: string) => byCode.get(code)?.status === "done" || licenceActive(code);
  const na = (code: string) => byCode.get(code)?.status === "not_applicable";
  const checks: Check[] = [];

  // VAT and EFD from the sales the app has invoiced (net of VAT, in TZS).
  const inv = (invRes.data ?? null) as { issue_date: string; total: number; vat_amount: number; exchange_rate: number }[] | null;
  if (inv) {
    const net = (r: { total: number; vat_amount: number; exchange_rate: number }) => (Number(r.total) - Number(r.vat_amount)) * Number(r.exchange_rate || 1);
    const s12 = inv.reduce((a, r) => a + net(r), 0);
    const since6 = addDays(today, -183);
    const s6 = inv.filter((r) => r.issue_date >= since6).reduce((a, r) => a + net(r), 0);
    const vatTitle = tr("VAT registration");
    if (company.vrn) {
      checks.push({ tone: "ok", title: vatTitle, detail: `${tr("VRN")} ${company.vrn}.` });
    } else if (s12 >= rules.vat_threshold_12m || s6 >= rules.vat_threshold_6m) {
      checks.push({
        tone: "bad",
        title: vatTitle,
        detail: `${tr("Invoiced sales passed the VAT threshold")} (${formatMoney(s12)} ${tr("in 12 months")}, ${formatMoney(s6)} ${tr("in 6 months")}). ${tr("Apply to TRA within")} ${rules.vat_register_days} ${tr("days")}.`,
        href: "/compliance/guide?code=TRA_VAT_REGISTRATION",
      });
    } else if (s12 >= rules.vat_threshold_12m * 0.8 || s6 >= rules.vat_threshold_6m * 0.8) {
      checks.push({
        tone: "warn",
        title: vatTitle,
        detail: `${tr("Close to the VAT threshold")}: ${formatMoney(s12)} ${tr("of")} ${formatMoney(rules.vat_threshold_12m)} ${tr("in 12 months")}.`,
        href: "/compliance/guide?code=TRA_VAT_REGISTRATION",
      });
    } else {
      checks.push({
        tone: "info",
        title: vatTitle,
        detail: `${tr("Not needed yet by the threshold")}: ${formatMoney(s12)} ${tr("invoiced in 12 months")}. ${tr("Many mines and big buyers only work with VAT-registered suppliers, so you may register voluntarily.")}`,
        href: "/compliance/guide?code=TRA_VAT_REGISTRATION",
      });
    }
    if (s12 >= rules.efd_threshold && !done("TRA_EFD") && !na("TRA_EFD")) {
      checks.push({
        tone: "warn",
        title: tr("EFD / VFD receipts"),
        detail: `${tr("Sales are above")} ${formatMoney(rules.efd_threshold)} ${tr("a year: every sale needs a fiscal receipt.")}`,
        href: "/compliance/guide?code=TRA_EFD",
      });
    }
  }

  if (!company.tin) {
    checks.push({ tone: "bad", title: tr("TIN"), detail: tr("No TIN in Settings. It must show on every invoice."), href: "/settings/company" });
  }

  if (!done("PDPC_REGISTRATION") && !na("PDPC_REGISTRATION")) {
    checks.push({
      tone: "warn",
      title: tr("Personal data (PDPC)"),
      detail: tr("The company keeps staff and client data: register as a data controller with the PDPC."),
      href: "/compliance/guide?code=PDPC_REGISTRATION",
    });
  } else if (!rules.dpo_name && !na("PDPC_REGISTRATION")) {
    checks.push({ tone: "info", title: tr("Personal data (PDPC)"), detail: tr("Name the person responsible for personal data."), href: "/compliance/rules" });
  }

  const noRegister = items.filter((i) => LICENCE_CODES.has(i.code) && i.status !== "not_applicable" && !i.licence_id && !licences.some((l) => l.catalogue_code === i.code));
  if (noRegister.length > 0) {
    checks.push({
      tone: "warn",
      title: tr("Licences register"),
      detail: `${noRegister.length} ${tr("licences on the checklist are not in the register yet, so nobody is reminded before they expire.")}`,
      href: "/compliance/licences",
      action: isManager ? "licences" : undefined,
    });
  }

  const changed = changedRules(rules).length;
  if (changed > 0) {
    checks.push({ tone: "info", title: tr("Tax & legal rules"), detail: `${changed} ${tr("rules changed from the law as shipped.")}`, href: "/compliance/rules" });
  }

  const problems = checks.filter((c) => c.tone === "bad" || c.tone === "warn").length;
  return (
    <section className="card">
      <div className="line-head" style={{ alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>{tr("Legal health check")}</h2>
        <span className={`badge tone-${problems ? "warn" : "ok"}`}>{problems ? `${problems} ${tr("to look at")}` : tr("All clear")}</span>
      </div>
      <ul className="lines" style={{ marginTop: 8 }}>
        {checks.map((c) => (
          <li key={c.title}>
            <div className="line-head" style={{ alignItems: "flex-start" }}>
              <span>
                <strong>{c.title}</strong>
                <br />
                <span className="small muted">{c.detail}</span>
              </span>
              <span className={`badge tone-${c.tone}`}>{c.tone === "ok" ? tr("OK") : c.tone === "bad" ? tr("Act now") : c.tone === "warn" ? tr("Check") : tr("Note")}</span>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 4 }}>
              {c.href && (
                <Link href={c.href} className="small">
                  {tr("Open →")}
                </Link>
              )}
              {c.action === "licences" && (
                <form action={addUsualLicences}>
                  <input type="hidden" name="back" value="/compliance" />
                  <SubmitButton className="btn btn-small">{tr("Add the usual licences to the register")}</SubmitButton>
                </form>
              )}
            </div>
          </li>
        ))}
      </ul>
      {!inv && <p className="small muted">{tr("The VAT check uses the invoices, which management, finance and sales can see.")}</p>}
    </section>
  );
}
