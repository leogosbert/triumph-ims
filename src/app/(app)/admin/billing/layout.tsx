import { primeLang } from "@/lib/tr";
import { platformAdmin } from "../guard";
import { BillingTabs } from "./BillingTabs";

/** Billing & services: what LeMo Tech sells, to whom, and what is paid. */
export default async function AdminBillingLayout({ children }: { children: React.ReactNode }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const { data } = await admin.supabase.rpc("platform_service_requests", { p_status: "requested" });
  return (
    <>
      <BillingTabs waiting={Array.isArray(data) ? data.length : 0} />
      {children}
    </>
  );
}
