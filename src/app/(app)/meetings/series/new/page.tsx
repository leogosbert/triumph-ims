import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { requireManager } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { SeriesForm } from "../SeriesForm";

export const metadata = { title: "New regular meeting" };

export default async function NewSeriesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company } = await requireManager();
  const people = await companyPeople(supabase, company.id);
  return (
    <>
      <div className="page-head">
        <h1>{tr("New regular meeting")}</h1>
      </div>
      <Notice {...notice} />
      <SeriesForm people={people} />
    </>
  );
}
