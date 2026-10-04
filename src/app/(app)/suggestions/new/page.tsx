import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import "../suggestions.css";
import { Notice } from "@/components/Notice";
import { NewSuggestionForm } from "@/components/suggestions/NewSuggestionForm";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { submitSuggestion } from "../actions";

export const metadata = { title: "New suggestion" };

export default async function NewSuggestionPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, isManager } = await getAppContext();
  const people = isManager ? await companyPeople(supabase, company.id) : [];

  return (
    <>
      <p className="small">
        <Link href="/suggestions">{tr("← Suggestion Box")}</Link>
      </p>
      <h1>{tr("New suggestion")}</h1>
      <Notice {...notice} />
      <div className="sg-hero">
        <div className="sg-hero-icon" aria-hidden>
          💡
        </div>
        <div>
          <strong>{tr("Your ideas move us forward.")}</strong>
          <p>
            {tr("How can we reduce costs, serve customers better, improve stock, procurement, safety or productivity?")}
          </p>
        </div>
      </div>
      <NewSuggestionForm action={submitSuggestion} isManager={isManager} people={people} />
      <p className="small muted">
        {tr("Management reads every suggestion. You can follow its status under “My suggestions”.")}
      </p>
    </>
  );
}
