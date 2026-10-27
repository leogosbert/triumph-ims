import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { aiReady } from "@/lib/ai/claude";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { addNotice } from "../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Paste a tender notice" };

export default async function NewNoticePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { role, features, isManager } = await getAppContext();
  if (!can(role, "seeCrm")) redirect("/");
  if (!features.on("tender_alerts")) return <FeatureOff title="Tender alerts" isManager={isManager} />;
  return (
    <>
      <BackLink href="/tenders/alerts" label="Tender alerts" />
      <h1>{tr("Paste a tender notice")}</h1>
      <Notice {...notice} />
      <form action={addNotice} className="card grid">
        <div className="field">
          <label htmlFor="raw_text">{tr("The advert or email text")}</label>
          <textarea id="raw_text" name="raw_text" rows={12} maxLength={20000} placeholder={tr("Copy the whole advert from the newspaper website, NeST, PPRA or the buyer's email and paste it here.")} />
        </div>
        <div className="field">
          <label htmlFor="title">
            {tr("Title")} <span className="hint">{tr("optional")}</span>
          </label>
          <input id="title" name="title" type="text" maxLength={300} placeholder={tr("e.g. Supply of hydraulic oils")} />
        </div>
        <div className="field">
          <label htmlFor="url">
            {tr("Link to the advert")} <span className="hint">{tr("optional")}</span>
          </label>
          <input id="url" name="url" type="url" maxLength={600} placeholder="https://" />
        </div>
        <p className="small muted">
          {aiReady()
            ? tr("The app reads the title, buyer, closing date and papers asked for (with AI when available), then scores it against what you sell.")
            : tr("The app reads the title, buyer, closing date and papers asked for, then scores it against what you sell.")}
        </p>
        <SubmitButton className="btn btn-primary" pendingText={tr("Reading…")}>
          {tr("Read and score")}
        </SubmitButton>
      </form>
    </>
  );
}
