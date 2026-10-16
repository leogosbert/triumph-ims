import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { formatDate } from "@/lib/format";
import { addDays, endOfLastMonth } from "@/lib/ledger";
import { readNotice, type SearchParams } from "@/lib/messages";
import { todayTz } from "@/lib/services";
import { closeBooks, reopenBooks } from "../actions";
import { BackLink, ledgerContext } from "../shared";

export const metadata = { title: "Close the books" };

export default async function CloseBooksPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { isManager, closedUntil } = await ledgerContext();
  const today = todayTz();
  const suggested = endOfLastMonth(today);

  return (
    <>
      <BackLink />
      <h1>{tr("Close the books")}</h1>
      <Notice {...notice} />
      <section className="card">
        <div className="stat">
          <div className="n">{closedUntil ? formatDate(closedUntil) : tr("Open")}</div>
          <div className="l">{tr(closedUntil ? "Books closed until" : "Nothing is closed yet")}</div>
        </div>
        <p className="small" style={{ marginBottom: 0 }}>
          {tr("Nothing dated on or before the closing day can change: no journals, and no changes to the entries of that period. A document changed or entered later still posts, on the first open day.")}
          {closedUntil && (
            <>
              {" "}
              {tr("First open day")}: <strong>{formatDate(addDays(closedUntil, 1))}</strong>.
            </>
          )}
        </p>
      </section>

      {isManager ? (
        <>
          <form action={closeBooks} className="card">
            <h2>{tr("Close up to a day")}</h2>
            <p className="muted small">{tr("Usually the last day of last month, once the accountant has finished it.")}</p>
            <div className="field">
              <label htmlFor="until">{tr("Close everything up to and including")}</label>
              <input id="until" name="until" type="date" required max={today} defaultValue={closedUntil && closedUntil > suggested ? closedUntil : suggested} />
            </div>
            <SubmitButton>{tr("Close the books")}</SubmitButton>
          </form>
          {closedUntil && (
            <form action={reopenBooks} className="card">
              <h2>{tr("Open the books again")}</h2>
              <p className="muted small">{tr("Only when a closed month really must be corrected. Close it again when you are done.")}</p>
              <label className="small" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 10 }}>
                <input type="checkbox" name="confirm" value="yes" required /> {tr("Yes, open every closed day again")}
              </label>
              <SubmitButton className="btn btn-danger btn-small">{tr("Open the books again")}</SubmitButton>
            </form>
          )}
        </>
      ) : (
        <p className="card muted small">{tr("Only management can close the books or open them again.")}</p>
      )}
    </>
  );
}
