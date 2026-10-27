import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext, noAccess } from "@/lib/context";
import { canUseInbox } from "@/lib/inbox/common";
import { readNotice, type SearchParams } from "@/lib/messages";
import { clientOptions } from "@/lib/options";
import { startConversation } from "../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New message" };

const pick = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

export default async function NewConversationPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, roles } = await getAppContext();
  if (!canUseInbox(roles)) noAccess();
  const channel = pick(sp.channel) === "whatsapp" ? "whatsapp" : "email";
  const link = /^(client|supplier):[0-9a-f-]{36}$/i.test(pick(sp.link)) ? pick(sp.link) : "";
  const [clients, { data: suppliers }] = await Promise.all([
    clientOptions(supabase, company.id),
    supabase.from("suppliers").select("id, name, email, phone").eq("company_id", company.id).eq("active", true).order("name").limit(2000),
  ]);

  // Fill in the address or phone from the linked client's first contact or the supplier.
  let address = pick(sp.address);
  if (!address && link) {
    const [kind, id] = link.split(":");
    if (kind === "client") {
      const { data } = await supabase.from("client_contacts").select("email, phone").eq("client_id", id).order("created_at").limit(5);
      const list = (data ?? []) as { email: string | null; phone: string | null }[];
      address = (channel === "email" ? list.find((x) => x.email)?.email : list.find((x) => x.phone)?.phone) ?? "";
    } else {
      const s = ((suppliers ?? []) as { id: string; email: string | null; phone: string | null }[]).find((x) => x.id === id);
      address = (channel === "email" ? s?.email : s?.phone) ?? "";
    }
    address = address.split(/[,;/]/)[0]?.trim() ?? "";
  }

  return (
    <>
      <BackLink href="/inbox" label="Inbox" />
      <h1>{tr("New message")}</h1>
      <p className="muted small">{tr("Start a conversation with a client or supplier. You write the message on the next screen.")}</p>
      <Notice {...notice} />
      <nav className="tabs-row" aria-label={tr("Channel")}>
        <Link href={`/inbox/new?channel=email${link ? `&link=${link}` : ""}`} aria-current={channel === "email" ? "page" : undefined}>
          {tr("Email")}
        </Link>
        <Link href={`/inbox/new?channel=whatsapp${link ? `&link=${link}` : ""}`} aria-current={channel === "whatsapp" ? "page" : undefined}>
          {tr("WhatsApp")}
        </Link>
      </nav>
      <form action={startConversation} className="card">
        <input type="hidden" name="channel" value={channel} />
        <div className="field">
          <label htmlFor="n-link">{tr("Client or supplier (optional)")}</label>
          <select id="n-link" name="link" defaultValue={link} style={{ maxWidth: "100%" }}>
            <option value="">{tr("Not linked")}</option>
            <optgroup label={tr("Clients")}>
              {clients.map((o) => (
                <option key={o.id} value={`client:${o.id}`}>
                  {o.name}
                </option>
              ))}
            </optgroup>
            {(suppliers ?? []).length > 0 && (
              <optgroup label={tr("Suppliers")}>
                {((suppliers ?? []) as { id: string; name: string }[]).map((o) => (
                  <option key={o.id} value={`supplier:${o.id}`}>
                    {o.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>
        <div className="field">
          <label htmlFor="n-address">{channel === "email" ? tr("Email address") : tr("WhatsApp number")}</label>
          <input
            id="n-address"
            name="address"
            required
            type={channel === "email" ? "email" : "tel"}
            inputMode={channel === "email" ? "email" : "tel"}
            defaultValue={address}
            placeholder={channel === "email" ? "name@client.co.tz" : "0712 345 678"}
            maxLength={200}
          />
        </div>
        <div className="field">
          <label htmlFor="n-name">{tr("Name (optional)")}</label>
          <input id="n-name" name="name" type="text" maxLength={200} defaultValue={pick(sp.name)} />
        </div>
        {channel === "email" && (
          <div className="field">
            <label htmlFor="n-subject">{tr("Subject")}</label>
            <input id="n-subject" name="subject" type="text" maxLength={300} />
          </div>
        )}
        <SubmitButton>{tr("Continue")}</SubmitButton>
      </form>
    </>
  );
}
