import type { BusinessProfile } from "@/lib/levels";
import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { startDemo } from "@/app/demo-actions";
import { getAppContext } from "@/lib/context";
import { readNotice, withNotice, type SearchParams } from "@/lib/messages";
import { finishOnboarding } from "./actions";
import { OnboardingWizard } from "./Wizard";

export const metadata = { title: "Set up your workspace" };

/**
 * Onboarding after a company is created: explains the three levels, asks a few questions,
 * recommends a starting level and lets the owner pick any level. Managers only.
 */
export default async function OnboardingPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) redirect(withNotice("/", { error: "Only management can set up the company's business level." }));
  if (company.is_demo) redirect("/");
  // The Stage 11 columns are missing until that database update is run.
  const ready = company.onboarding_done !== undefined;
  // Earlier answers (manager-only table).
  const { data: savedProfile } = ready ? await supabase.rpc("company_profile", { p_company: company.id }) : { data: null };

  const brandStyle = {
    "--brand": company.primary_color,
    "--brand-dark": company.accent_color,
  } as React.CSSProperties;

  return (
    <div className="onb-wrap" style={brandStyle}>
      <header className="onb-top">
        <img src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
        <span>{company.name}</span>
      </header>
      <Notice {...notice} />
      <OnboardingWizard
        companyName={company.name}
        initial={(savedProfile as BusinessProfile | null) ?? {}}
        currentLevel={company.business_level ?? "medium"}
        ready={ready}
        finishAction={finishOnboarding}
        demoAction={startDemo}
      />
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
