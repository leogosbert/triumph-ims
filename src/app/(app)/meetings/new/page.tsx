import { redirect } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { canOrganise } from "@/lib/meetings/model";
import { createMeeting } from "../actions";
import { MeetingForm } from "../parts";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "New meeting" };

export default async function NewMeetingPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, user } = await getAppContext();
  if (!canOrganise(roles)) redirect("/meetings");
  const [people, clients, suppliers] = await Promise.all([
    companyPeople(supabase, company.id),
    supabase.from("clients").select("id, name").eq("company_id", company.id).order("name").limit(1000),
    supabase.from("suppliers").select("id, name").eq("company_id", company.id).order("name").limit(1000),
  ]);
  return (
    <>
      <BackLink href="/meetings" label="Meetings" />
      <div className="page-head">
        <h1>{tr("New meeting")}</h1>
      </div>
      <Notice {...notice} />
      <MeetingForm
        action={createMeeting}
        people={people}
        clients={(clients.data ?? []) as { id: string; name: string }[]}
        suppliers={(suppliers.data ?? []) as { id: string; name: string }[]}
        me={user.id}
      />
    </>
  );
}
