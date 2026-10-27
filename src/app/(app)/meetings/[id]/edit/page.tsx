import { notFound, redirect } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { canManage, MEETING_COLUMNS, type Meeting } from "@/lib/meetings/model";
import { updateMeeting } from "../../actions";
import { MeetingForm } from "../../parts";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Change meeting" };

export default async function EditMeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  const { data } = await supabase.from("meetings").select(MEETING_COLUMNS).eq("id", id).maybeSingle();
  if (!data) notFound();
  const m = data as unknown as Meeting;
  if (!canManage(m, user.id, role) || !["planned", "live"].includes(m.status)) redirect(`/meetings/${id}`);
  const [people, clients, suppliers, att] = await Promise.all([
    companyPeople(supabase, company.id),
    supabase.from("clients").select("id, name").eq("company_id", company.id).order("name").limit(1000),
    supabase.from("suppliers").select("id, name").eq("company_id", company.id).order("name").limit(1000),
    supabase.from("meeting_attendees").select("user_id").eq("meeting_id", id).not("user_id", "is", null),
  ]);
  return (
    <>
      <BackLink href={`/meetings/${id}`} label={m.title} />
      <div className="page-head">
        <h1>{tr("Change meeting")}</h1>
      </div>
      <Notice {...notice} />
      <MeetingForm
        action={updateMeeting}
        people={people}
        clients={(clients.data ?? []) as { id: string; name: string }[]}
        suppliers={(suppliers.data ?? []) as { id: string; name: string }[]}
        m={m}
        attendees={((att.data ?? []) as { user_id: string }[]).map((a) => a.user_id)}
        me={user.id}
      />
    </>
  );
}
