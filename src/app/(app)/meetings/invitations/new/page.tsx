import { redirect } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { canOrganise } from "@/lib/meetings/model";
import { addInvitation } from "../../actions";
import styles from "../../meetings.module.css";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Add an invitation" };

export default async function NewInvitationPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  if (!canOrganise(role)) redirect("/meetings");
  const [people, clients, suppliers] = await Promise.all([
    companyPeople(supabase, company.id),
    supabase.from("clients").select("id, name").eq("company_id", company.id).order("name").limit(1000),
    supabase.from("suppliers").select("id, name").eq("company_id", company.id).order("name").limit(1000),
  ]);
  return (
    <>
      <BackLink href="/meetings/invitations" label="Invitations" />
      <div className="page-head">
        <h1>{tr("Add an invitation we got")}</h1>
      </div>
      <p className="small muted">{tr("A client or supplier invited you to their Zoom, Teams or Google Meet meeting. Paste the link: it goes on the calendar with a Join button, and the people you choose are told.")}</p>
      <Notice {...notice} />
      <form action={addInvitation} className="card">
        <label className="field">
          <span>{tr("Meeting link")}</span>
          <input type="url" name="link" required maxLength={500} placeholder="https://teams.microsoft.com/l/meetup-join/…" />
        </label>
        <label className="field">
          <span>{tr("Title")}</span>
          <input name="title" required minLength={2} maxLength={160} />
        </label>
        <div className="inline-form">
          <label className="field">
            <span>{tr("Date and time")}</span>
            <input type="datetime-local" name="starts_at" required />
          </label>
          <label className="field">
            <span>{tr("Minutes")}</span>
            <input type="number" name="minutes" min={5} max={600} step={5} defaultValue={60} />
          </label>
        </div>
        <div className="inline-form">
          <label className="field">
            <span>{tr("Who invited us")}</span>
            <input name="organiser" maxLength={120} />
          </label>
          <label className="field">
            <span>{tr("Their company")}</span>
            <input name="organiser_company" maxLength={160} />
          </label>
          <label className="field">
            <span>{tr("Their email")}</span>
            <input type="email" name="organiser_email" maxLength={200} />
          </label>
        </div>
        <div className="inline-form">
          <label className="field">
            <span>{tr("Client")}</span>
            <select name="client_id" defaultValue="">
              <option value="">{tr("Found from the email, or none")}</option>
              {((clients.data ?? []) as { id: string; name: string }[]).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{tr("Supplier")}</span>
            <select name="supplier_id" defaultValue="">
              <option value="">{tr("Found from the email, or none")}</option>
              {((suppliers.data ?? []) as { id: string; name: string }[]).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>{tr("Notes")}</span>
          <textarea name="notes" rows={2} maxLength={2000} />
        </label>
        <fieldset className="field">
          <legend>{tr("Who from our side attends")}</legend>
          <div className={styles.chips}>
            {people
              .filter((p) => p.id !== user.id)
              .map((p) => (
                <label key={p.id} className={styles.chip}>
                  <input type="checkbox" name="attendees" value={p.id} /> {p.name}
                </label>
              ))}
          </div>
        </fieldset>
        <SubmitButton>{tr("Add to the calendar")}</SubmitButton>
      </form>
    </>
  );
}
