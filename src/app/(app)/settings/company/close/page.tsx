import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { StepUpForm } from "@/components/ConfirmIdentity";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { requestCompanyClosure } from "@/app/deletion-actions";
import { requireManager } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";

export const metadata = { title: "Close company account" };

/** Settings → Company details → "Close company account" (management, real companies only). */
export default async function CloseCompanyPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { company } = await requireManager();

  return (
    <>
      <p className="small">
        <Link href="/settings/company">{tr("← Company details")}</Link>
      </p>
      <h1>{tr("Close company account")}</h1>
      <Notice {...notice} />

      {company.is_demo ? (
        <section className="card">
          <p style={{ margin: 0 }}>{tr("This is a demo company. It deletes itself after 48 hours, or straight away with Exit demo.")}</p>
        </section>
      ) : (
        <>
          <section className="card del-warn">
            <h2>{tr("First: download a final backup")}</h2>
            <p className="small">
              {tr("The backup file is your own copy of all your records. Tanzanian law requires businesses to keep records (for example tax records) for several years — check with your accountant. After the closure we cannot give them back.")}
            </p>
            <Link href="/settings/backups" className="btn btn-primary">
              {tr("Download a final backup")}
            </Link>
          </section>

          <section className="card">
            <h2>{tr("What happens")}</h2>
            <ul className="del-list">
              <li>{tr("Straight away: everyone except management loses access, and every member is told.")}</li>
              <li>{tr("Managers still see a closing screen where they can cancel the closure or download a final backup.")}</li>
              <li>
                {tr("After 30 days all of")} {company.name}
                {tr("'s data is deleted for good: clients, suppliers, products, quotations, orders, stock, deliveries, invoices, payments, files and backups.")}
              </li>
              <li>{tr("People keep their own LeMoSp accounts and their other companies.")}</li>
            </ul>
          </section>

          <StepUpForm action={requestCompanyClosure} className="card danger-zone">
            <h2>{tr("Close company account")}</h2>
            <div className="field">
              <label htmlFor="company_name">
                {tr("Type the company name to confirm:")} <strong>{company.name}</strong>
              </label>
              <input id="company_name" name="company_name" type="text" autoComplete="off" spellCheck={false} required />
            </div>
            <SubmitButton className="btn btn-danger-solid btn-block" pendingText={tr("Please wait…")}>
              {tr("Close company account")}
            </SubmitButton>
            <p className="small muted" style={{ marginBottom: 0 }}>{tr("You will be asked for your password first.")}</p>
          </StepUpForm>
        </>
      )}
    </>
  );
}
