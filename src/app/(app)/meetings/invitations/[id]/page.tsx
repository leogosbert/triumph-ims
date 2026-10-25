import Link from "next/link";
import { notFound } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { requireManager } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { formatWhen, toLocalInput } from "@/lib/services";
import { INVITATION_STATUS, type Invitation } from "@/lib/meetings/model";
import { decideInvitation } from "../../actions";
import styles from "../../meetings.module.css";

export const metadata = { title: "Meeting request" };

export default async function InvitationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, user } = await requireManager();
  const { data } = await supabase.from("meeting_invitations").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!data) notFound();
  const r = data as Invitation;
  const [people, client, supplier] = await Promise.all([
    companyPeople(supabase, company.id),
    r.client_id ? supabase.from("clients").select("id, name").eq("id", r.client_id).maybeSingle() : Promise.resolve({ data: null }),
    r.supplier_id ? supabase.from("suppliers").select("id, name").eq("id", r.supplier_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  return (
    <>
      <div className="page-head">
        <h1>{r.topic}</h1>
        <span className={`badge tone-${INVITATION_STATUS[r.status]?.tone}`}>{tr(INVITATION_STATUS[r.status]?.label ?? r.status)}</span>
      </div>
      <Notice {...notice} />
      <section className="card">
        <dl className="kv">
          <dt>{tr("From")}</dt>
          <dd>
            {r.requester_name}
            {r.requester_company && ` · ${r.requester_company}`}
            {client.data && (
              <>
                {" · "}
                <Link href={`/clients/${client.data.id}`}>{client.data.name}</Link>
              </>
            )}
            {supplier.data && (
              <>
                {" · "}
                <Link href={`/suppliers/${supplier.data.id}`}>{supplier.data.name}</Link>
              </>
            )}
          </dd>
          <dt>{tr("Contact")}</dt>
          <dd>{[r.requester_email, r.requester_phone ? `+${r.requester_phone}` : null].filter(Boolean).join(" · ") || "-"}</dd>
          <dt>{tr("Asked for")}</dt>
          <dd>
            {formatWhen(r.proposed_at)} · {r.minutes} {tr("min")}
          </dd>
          {r.external_link && (
            <>
              <dt>{tr("Their link")}</dt>
              <dd style={{ wordBreak: "break-all" }}>{r.external_link}</dd>
            </>
          )}
          {r.message && (
            <>
              <dt>{tr("Message")}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{r.message}</dd>
            </>
          )}
          {r.reply && (
            <>
              <dt>{tr("Our reply")}</dt>
              <dd style={{ whiteSpace: "pre-wrap" }}>{r.reply}</dd>
            </>
          )}
        </dl>
        {r.meeting_id && (
          <Link href={`/meetings/${r.meeting_id}`} className="btn">
            {tr("Open the meeting")}
          </Link>
        )}
      </section>
      {r.status === "pending" && (
        <>
          <form action={decideInvitation} className="card">
            <h2>{tr("Accept")}</h2>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="accept" value="1" />
            <label className="field">
              <span>{tr("Date and time (change it to suggest another time)")}</span>
              <input type="datetime-local" name="starts_at" defaultValue={toLocalInput(r.proposed_at)} required />
            </label>
            <fieldset className="field">
              <legend>{tr("Who from our side attends")}</legend>
              <div className={styles.chips}>
                {people.map((p) => (
                  <label key={p.id} className={styles.chip}>
                    <input type="checkbox" name="attendees" value={p.id} defaultChecked={p.id === user.id} /> {p.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="field">
              <span>{tr("Message to them (optional)")}</span>
              <textarea name="reply" rows={2} maxLength={2000} />
            </label>
            {r.requester_email && (
              <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}>
                <input type="checkbox" name="email" value="1" defaultChecked /> {tr("Email them the confirmation and the link to join")}
              </label>
            )}
            <SubmitButton>{tr("Accept and put it on the calendar")}</SubmitButton>
          </form>
          <form action={decideInvitation} className="card">
            <h2>{tr("Decline")}</h2>
            <input type="hidden" name="id" value={id} />
            <input type="hidden" name="accept" value="0" />
            <label className="field">
              <span>{tr("Reply")}</span>
              <textarea name="reply" rows={2} maxLength={2000} placeholder={tr("e.g. We are away that week. Could we meet on Tuesday instead?")} />
            </label>
            {r.requester_email && (
              <label className="small" style={{ display: "flex", gap: 8, alignItems: "center", margin: "6px 0" }}>
                <input type="checkbox" name="email" value="1" defaultChecked /> {tr("Email them the reply")}
              </label>
            )}
            <SubmitButton className="btn">{tr("Decline")}</SubmitButton>
          </form>
        </>
      )}
    </>
  );
}
