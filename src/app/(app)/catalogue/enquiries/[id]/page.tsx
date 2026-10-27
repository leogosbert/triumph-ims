import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { ENQUIRY_STATUS } from "@/lib/growth-tools/catalogue";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { closeEnquiry, convertEnquiry } from "../../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Catalogue request" };

type Line = { product_id: string; name: string; sku: string | null; quantity: number; unit: string };

export default async function EnquiryPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, features, isManager } = await getAppContext();
  if (!can(roles, "seeCrm")) redirect("/");
  if (!features.on("online_catalogue")) return <FeatureOff title="Online catalogue" isManager={isManager} />;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data: e } = await supabase.from("catalogue_enquiries").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!e) notFound();
  const { data: clients } = await supabase.from("clients").select("id, name").eq("company_id", company.id).eq("active", true).order("name").limit(3000);
  const lines = (Array.isArray(e.lines) ? e.lines : []) as Line[];
  const known = (clients ?? []).find((c) => c.id === e.client_id);

  return (
    <>
      <BackLink href="/catalogue/enquiries" label="Catalogue requests" />
      <div className="page-head">
        <h1 style={{ margin: 0 }}>{e.name}</h1>
        <StatusBadge map={ENQUIRY_STATUS} status={e.status} />
      </div>
      <p className="muted small">
        {e.kind === "quote" ? tr("Request for quotation") : tr("Enquiry")} · {formatDateTime(e.created_at)}
      </p>
      <Notice {...notice} />
      <section className="card">
        <dl className="kv">
          {e.company_name && (
            <>
              <dt>{tr("Company")}</dt>
              <dd>{e.company_name}</dd>
            </>
          )}
          {e.email && (
            <>
              <dt>{tr("Email")}</dt>
              <dd>
                <a href={`mailto:${e.email}`}>{e.email}</a>
              </dd>
            </>
          )}
          {e.phone && (
            <>
              <dt>{tr("Phone")}</dt>
              <dd>
                <a href={`tel:+${e.phone}`}>+{e.phone}</a> · <a href={`https://wa.me/${e.phone}`} target="_blank" rel="noopener noreferrer">WhatsApp</a>
              </dd>
            </>
          )}
          {known && (
            <>
              <dt>{tr("Client")}</dt>
              <dd>
                <Link href={`/clients/${known.id}`}>{known.name}</Link>
              </dd>
            </>
          )}
        </dl>
        {e.message && <p style={{ whiteSpace: "pre-wrap" }}>{e.message}</p>}
        {e.conversation_id && (
          <p className="small">
            <Link href={`/inbox/${e.conversation_id}`}>{tr("Open in the Inbox to reply")}</Link>
          </p>
        )}
      </section>
      {lines.length > 0 && (
        <section className="card">
          <h2>{tr("Products")}</h2>
          <ul className="list">
            {lines.map((l, i) => (
              <li key={i} className="row" style={{ justifyContent: "space-between" }}>
                <span>
                  <Link href={`/products/${l.product_id}`}>{l.name}</Link>
                  {l.sku && <span className="small muted"> · {l.sku}</span>}
                </span>
                <strong>
                  {Number(l.quantity).toLocaleString("en-GB", { maximumFractionDigits: 3 })} {l.unit}
                </strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      {e.rfq_id ? (
        <p>
          <Link href={`/rfqs/${e.rfq_id}`} className="btn btn-primary">
            {tr("Open the RFQ")}
          </Link>
        </p>
      ) : (
        e.status !== "closed" && (
          <form action={convertEnquiry} className="card grid">
            <input type="hidden" name="id" value={e.id} />
            <h2 style={{ margin: 0 }}>{tr("Make the RFQ")}</h2>
            <div className="field">
              <label htmlFor="client_id">{tr("Client")}</label>
              <select id="client_id" name="client_id" defaultValue={e.client_id ?? ""}>
                <option value="">{tr("New client from these details")}</option>
                {(clients ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <SubmitButton className="btn btn-primary" pendingText="…">
              {tr("Make client RFQ")}
            </SubmitButton>
          </form>
        )
      )}
      <form action={closeEnquiry} style={{ marginTop: 12 }}>
        <input type="hidden" name="id" value={e.id} />
        <input type="hidden" name="closed" value={e.status === "closed" ? "0" : "1"} />
        <SubmitButton className="btn btn-small" pendingText="…">
          {e.status === "closed" ? tr("Open again") : tr("Close (no action needed)")}
        </SubmitButton>
      </form>
    </>
  );
}
