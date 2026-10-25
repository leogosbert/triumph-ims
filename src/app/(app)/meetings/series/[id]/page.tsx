import { notFound } from "next/navigation";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { requireManager } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { SeriesForm, type Series } from "../SeriesForm";

export const metadata = { title: "Regular meeting" };

export default async function EditSeriesPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  await primeLang();
  const { id } = await params;
  const notice = await readNotice(searchParams);
  const { supabase, company } = await requireManager();
  const { data } = await supabase.from("meeting_series").select("*").eq("id", id).eq("company_id", company.id).maybeSingle();
  if (!data) notFound();
  const people = await companyPeople(supabase, company.id);
  return (
    <>
      <div className="page-head">
        <h1>{(data as Series).title}</h1>
      </div>
      <p className="small muted">{tr("Changes apply to meetings planned from now on; meetings already planned keep their details.")}</p>
      <Notice {...notice} />
      <SeriesForm s={data as Series} people={people} />
    </>
  );
}
