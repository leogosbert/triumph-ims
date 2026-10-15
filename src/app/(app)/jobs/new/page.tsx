import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { companyPeople } from "@/lib/people";
import { canPlanService } from "@/lib/services";
import { storeOptions } from "@/lib/stock";
import { createJob } from "../actions";
import { JobFields } from "../JobFields";

export const metadata = { title: "New service job" };

const pick = (v: string | string[] | undefined) => (typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

export default async function NewJobPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const sp = (await searchParams) ?? {};
  const { supabase, company, role } = await getAppContext();
  if (!canPlanService(role)) redirect("/jobs");
  const probe = await supabase.from("service_jobs").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="New service job" />;

  const equipmentId = pick(sp.equipment);
  const quotationId = pick(sp.quotation);
  const [clients, people, stores, { data: eqData }, { data: prjData }, { data: quote }] = await Promise.all([
    clientOptions(supabase, company.id),
    companyPeople(supabase, company.id),
    storeOptions(supabase, company.id),
    supabase.from("client_equipment").select("id, name, serial_no, location, client_id, client:clients(name)").eq("company_id", company.id).eq("active", true).order("name").limit(1000),
    supabase.from("projects").select("id, name, number, client_id").eq("company_id", company.id).eq("status", "active").order("created_at", { ascending: false }).limit(300),
    quotationId
      ? supabase.from("quotations").select("id, number, client_id, contact_name").eq("id", quotationId).eq("company_id", company.id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  type Eq = { id: string; name: string; serial_no: string | null; location: string | null; client_id: string; client: { name: string } | null };
  const equipment = (eqData ?? []) as unknown as Eq[];
  const chosenEq = equipment.find((e) => e.id === equipmentId) ?? null;
  const clientId = pick(sp.client) ?? chosenEq?.client_id ?? quote?.client_id ?? null;
  const projects = ((prjData ?? []) as { id: string; name: string; number: string; client_id: string }[]).map((p) => ({
    id: p.id,
    name: `${p.number} · ${p.name}`,
  }));
  // Technicians first: warehouse and drivers often do the field work, then everyone else.
  const order = ["warehouse", "driver", "sales", "management", "procurement", "finance"];
  const team = [...people].sort((a, b) => order.indexOf(a.role) - order.indexOf(b.role) || a.name.localeCompare(b.name));
  const currencies = [company.base_currency, ...(company.second_currency && company.second_currency !== company.base_currency ? [company.second_currency] : [])];

  return (
    <>
      <p className="small">
        <Link href="/jobs">{tr("← Service jobs")}</Link>
      </p>
      <h1>{tr("New service job")}</h1>
      <Notice {...notice} />
      {quote && (
        <p className="banner small">
          {tr("For quotation")} {quote.number}. {tr("Set a price only if this work is not already billed on the quotation's invoice.")}
        </p>
      )}
      <form action={createJob} className="card">
        {quote && <input type="hidden" name="quotation_id" value={quote.id} />}
        <div className="field">
          <label htmlFor="client_id">{tr("Client")}</label>
          <select id="client_id" name="client_id" required defaultValue={clientId ?? ""}>
            <option value="" disabled>
              {tr("Choose…")}
            </option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          {clients.length === 0 && (
            <span className="hint small">
              <Link href="/clients/new">{tr("+ New client")}</Link>
            </span>
          )}
        </div>
        <JobFields
          v={{
            kind: chosenEq ? "maintenance" : quote ? "delivery_install" : "installation",
            title: chosenEq ? `${tr("Service")}: ${chosenEq.name}` : "",
            site: chosenEq?.location ?? null,
            contact: quote?.contact_name ?? null,
            equipment_id: chosenEq?.id ?? null,
            currency: company.base_currency,
          }}
          people={team}
          stores={stores.map((s) => ({ id: s.id, name: s.name }))}
          equipment={equipment.map((e) => ({ id: e.id, name: `${e.name}${e.serial_no ? ` (${e.serial_no})` : ""} · ${e.client?.name ?? ""}` }))}
          projects={projects}
          currencies={currencies}
        />
        <div className="field">
          <label htmlFor="checklist">{tr("Checklist")}</label>
          <textarea id="checklist" name="checklist" rows={4} placeholder={tr("One point per line, e.g.\nCheck the pressure\nTighten all joints\nClean the site")} />
        </div>
        <SubmitButton className="btn btn-primary btn-block">{tr("Create job")}</SubmitButton>
      </form>
    </>
  );
}
