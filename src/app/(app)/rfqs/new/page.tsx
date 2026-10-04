import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { RfqHeaderFields } from "@/components/RfqHeaderFields";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { companyPeople } from "@/lib/people";
import { can } from "@/lib/roles";
import { todayTz } from "@/lib/sales";
import { saveRfq } from "../actions";

export const metadata = { title: "New RFQ" };

export default async function NewRfqPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editSales")) redirect("/rfqs");
  const [clients, people] = await Promise.all([clientOptions(supabase, company.id), companyPeople(supabase, company.id)]);

  return (
    <>
      <p className="small">
        <Link href="/rfqs">{tr("← RFQs")}</Link>
      </p>
      <h1>{tr("New client RFQ")}</h1>
      <p className="muted small">{tr("Record a request for quotation from a client. You'll add the items next.")}</p>
      <Notice {...notice} />
      {clients.length === 0 ? (
        <p className="card">{tr("Add the client first:")}{" "}<Link href="/clients/new">{tr("+ New client")}</Link>
        </p>
      ) : (
        <form action={saveRfq} className="card">
          <input type="hidden" name="id" value="" />
          <RfqHeaderFields
            values={{ client_id: typeof sp.client === "string" ? sp.client : "", received_on: todayTz() }}
            clients={clients}
            people={people}
          />
          <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Saving…")}>{tr("Save RFQ")}</SubmitButton>
        </form>
      )}
    </>
  );
}
