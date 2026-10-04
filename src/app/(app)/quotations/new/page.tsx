import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { can } from "@/lib/roles";
import { newQuotation } from "../actions";

export const metadata = { title: "New quotation" };

export default async function NewQuotationPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "editSales")) redirect("/quotations");
  const clients = await clientOptions(supabase, company.id);

  return (
    <>
      <p className="small">
        <Link href="/quotations">{tr("← Quotations")}</Link>
      </p>
      <h1>{tr("New quotation")}</h1>
      <p className="muted small">{tr("For a quotation that answers a client RFQ, open the RFQ and use “Create quotation” instead, so the items are copied across.")}</p>
      <Notice {...notice} />
      <form action={newQuotation} className="card">
        <div className="field">
          <label htmlFor="client_id">{tr("Client")}</label>
          <select id="client_id" name="client_id" required defaultValue={typeof sp.client === "string" ? sp.client : ""}>
            <option value="" disabled>{tr("Choose a client")}</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Creating…")}>{tr("Create draft quotation")}</SubmitButton>
      </form>
    </>
  );
}
