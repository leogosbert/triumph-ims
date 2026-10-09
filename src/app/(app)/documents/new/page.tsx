import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { getAppContext } from "@/lib/context";
import { DOC_KINDS, isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { loadLinkOptions } from "../links";
import { NewDocumentForm } from "../NewDocumentForm";

export const metadata = { title: "New document" };

export default async function NewDocumentPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "seeDocuments")) redirect("/");
  const probe = await supabase.from("documents").select("id").eq("company_id", company.id).limit(1);
  if (isMissingTable(probe.error)) return <NotReady title="New document" />;
  const links = await loadLinkOptions(supabase, company.id);
  const pick = (k: string) => (typeof sp[k] === "string" && /^[0-9a-f-]{36}$/.test(sp[k] as string) ? (sp[k] as string) : null);
  const kind = typeof sp.kind === "string" && DOC_KINDS.some((k) => k.key === sp.kind) ? sp.kind : undefined;
  const rawBack = typeof sp.back === "string" ? sp.back : null;
  const back = rawBack && rawBack.startsWith("/") && !rawBack.startsWith("//") ? rawBack : null;

  return (
    <>
      <p className="small">
        <Link href={back ?? "/documents"}>{back ? tr("← Back") : tr("← Documents")}</Link>
      </p>
      <h1>{tr("Add a document")}</h1>
      <p className="muted small">{tr("Certificates, licences, safety data sheets, CoAs, datasheets, contracts and tender papers. Add the expiry date to be reminded before it runs out.")}</p>
      <Notice {...notice} />
      <NewDocumentForm
        companyId={company.id}
        back={back}
        links={links}
        start={{
          kind,
          product_id: pick("product"),
          supplier_id: pick("supplier"),
          client_id: pick("client"),
          tender_id: pick("tender"),
          contract_id: pick("contract"),
        }}
      />
    </>
  );
}
