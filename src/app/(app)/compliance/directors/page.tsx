import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import {
  canSeeCompliance,
  DIRECTOR_FIELDS,
  DIRECTOR_ROLES,
  ID_TYPES,
  MONTHS,
  num,
  type ComplianceSettings,
  type Director,
} from "@/lib/compliance/model";
import { deleteDirector, saveComplianceSettings, saveDirector, setSharesDecided } from "../actions";
import { ComplianceTabs, Disclaimer } from "../parts";

export const metadata = { title: "Directors & shares" };

function DirectorFields({ v }: { v: Partial<Director> }) {
  const k = v.id ?? "new";
  return (
    <div className="grid grid-2">
      {v.id && <input type="hidden" name="id" value={v.id} />}
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor={`full_name_${k}`}>{tr("Full name")}</label>
        <input id={`full_name_${k}`} name="full_name" type="text" required minLength={2} maxLength={160} defaultValue={v.full_name ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`role_${k}`}>{tr("Role")}</label>
        <select id={`role_${k}`} name="role" defaultValue={v.role ?? "director"}>
          {Object.entries(DIRECTOR_ROLES).map(([key, label]) => (
            <option key={key} value={key}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`share_percent_${k}`}>
          {tr("Share %")} <span className="hint">· {tr("empty while not decided")}</span>
        </label>
        <input id={`share_percent_${k}`} name="share_percent" type="number" min={0} max={100} step="0.001" defaultValue={v.share_percent ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`id_type_${k}`}>{tr("ID")}</label>
        <select id={`id_type_${k}`} name="id_type" defaultValue={v.id_type ?? "nida"}>
          {Object.entries(ID_TYPES).map(([key, label]) => (
            <option key={key} value={key}>
              {tr(label)}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`id_number_${k}`}>{tr("ID number")}</label>
        <input id={`id_number_${k}`} name="id_number" type="text" maxLength={40} defaultValue={v.id_number ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`tin_${k}`}>{tr("Personal TIN")}</label>
        <input id={`tin_${k}`} name="tin" type="text" maxLength={30} defaultValue={v.tin ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`nationality_${k}`}>{tr("Nationality")}</label>
        <input id={`nationality_${k}`} name="nationality" type="text" maxLength={60} defaultValue={v.nationality ?? "Tanzanian"} />
      </div>
      <div className="field">
        <label htmlFor={`shares_held_${k}`}>{tr("Number of shares")}</label>
        <input id={`shares_held_${k}`} name="shares_held" type="number" min={0} step="1" defaultValue={v.shares_held ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`appointed_on_${k}`}>{tr("Appointed on")}</label>
        <input id={`appointed_on_${k}`} name="appointed_on" type="date" defaultValue={v.appointed_on ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`phone_${k}`}>{tr("Phone")}</label>
        <input id={`phone_${k}`} name="phone" type="tel" maxLength={40} defaultValue={v.phone ?? ""} />
      </div>
      <div className="field">
        <label htmlFor={`email_${k}`}>{tr("Email")}</label>
        <input id={`email_${k}`} name="email" type="email" maxLength={120} defaultValue={v.email ?? ""} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor={`address_${k}`}>{tr("Address")}</label>
        <input id={`address_${k}`} name="address" type="text" maxLength={300} defaultValue={v.address ?? ""} />
      </div>
      {v.id && (
        <div className="field">
          <label htmlFor={`resigned_on_${k}`}>
            {tr("Resigned on")} <span className="hint">· {tr("keeps the history")}</span>
          </label>
          <input id={`resigned_on_${k}`} name="resigned_on" type="date" defaultValue={v.resigned_on ?? ""} />
        </div>
      )}
      <div className="field">
        <label htmlFor={`sort_${k}`}>{tr("Order")}</label>
        <input id={`sort_${k}`} name="sort" type="number" min={0} max={999} defaultValue={v.sort ?? 0} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor={`notes_${k}`}>{tr("Notes")}</label>
        <textarea id={`notes_${k}`} name="notes" maxLength={1000} defaultValue={v.notes ?? ""} />
      </div>
    </div>
  );
}

export default async function DirectorsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role, isManager } = await getAppContext();
  if (!canSeeCompliance(role)) redirect("/");
  const seesPeople = role === "management" || role === "finance";
  const [setRes, dirRes] = await Promise.all([
    supabase.from("compliance_settings").select("year_end_month, incorporated_on, shares_decided, shares_decided_at, shareholding_note, board_note, legal_rules").eq("company_id", company.id).maybeSingle(),
    seesPeople ? supabase.from("company_directors").select(DIRECTOR_FIELDS).eq("company_id", company.id).order("sort").order("full_name").limit(200) : Promise.resolve({ data: [], error: null }),
  ]);
  if (isMissingTable(setRes.error) || isMissingTable(dirRes.error)) return <NotReady title="Directors & shares" />;
  const st = (setRes.data ?? { year_end_month: 12, incorporated_on: null, shares_decided: false, shares_decided_at: null, shareholding_note: null, board_note: null, legal_rules: {} }) as ComplianceSettings;
  const all = (dirRes.data ?? []) as Director[];
  const current = all.filter((d) => !d.resigned_on);
  const past = all.filter((d) => d.resigned_on);
  const total = current.reduce((a, d) => a + num(d.share_percent), 0);
  const directors = current.filter((d) => d.role !== "shareholder").length;

  return (
    <>
      <h1>{tr("Directors & shares")}</h1>
      <ComplianceTabs current="/compliance/directors" />
      <p className="muted small">{tr("Who runs and owns the company, as BRELA has it. Banks, tenders and mines ask for this, and the beneficial owners return needs it.")}</p>
      <Notice {...notice} />

      {!st.shares_decided && (
        <section className="banner warn">
          <strong>{tr("Shares not yet decided.")}</strong>{" "}
          {tr(
            "Record the directors now; leave the percentages empty or as a draft. When the directors agree, write the decision in board minutes, file the shareholding (and any change of the MEMART) with BRELA, then mark it decided here.",
          )}
        </section>
      )}

      {!seesPeople ? (
        <p className="card muted">{tr("Director details (IDs, TINs) are kept for management and finance only.")}</p>
      ) : (
        <>
          <section className="card">
            <div className="line-head" style={{ alignItems: "baseline" }}>
              <h2 style={{ margin: 0 }}>{tr("Current directors and shareholders")}</h2>
              <span className="small muted">
                {directors} {tr("directors")}
              </span>
            </div>
            {current.length === 0 ? (
              <p className="small muted">{tr("None recorded yet. Add each director as on the BRELA certificate.")}</p>
            ) : (
              <ul className="lines">
                {current.map((d) => (
                  <li key={d.id}>
                    <div className="line-head" style={{ alignItems: "flex-start" }}>
                      <span>
                        <strong>{d.full_name}</strong> <span className="small muted">· {tr(DIRECTOR_ROLES[d.role])}</span>
                        <br />
                        <span className="small muted">
                          {[
                            d.id_number && `${tr(ID_TYPES[d.id_type])} ${d.id_number}`,
                            d.tin && `TIN ${d.tin}`,
                            d.appointed_on && `${tr("since")} ${formatDate(d.appointed_on)}`,
                            d.phone,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                      <strong>{d.share_percent !== null ? `${num(d.share_percent)}%` : st.shares_decided ? "—" : tr("not decided")}</strong>
                    </div>
                    {isManager && (
                      <details style={{ marginTop: 4 }}>
                        <summary className="small">{tr("Edit")}</summary>
                        <form action={saveDirector} style={{ marginTop: 8 }}>
                          <DirectorFields v={d} />
                          <SubmitButton className="btn btn-small btn-primary">{tr("Save")}</SubmitButton>
                        </form>
                        <form action={deleteDirector} style={{ marginTop: 8 }}>
                          <input type="hidden" name="id" value={d.id} />
                          <SubmitButton className="btn btn-small" pendingText="…">
                            {tr("Remove (entered by mistake)")}
                          </SubmitButton>
                        </form>
                      </details>
                    )}
                  </li>
                ))}
                <li className="line-head">
                  <strong>{tr("Total shares recorded")}</strong>
                  <strong className={total > 100 ? "text-warn" : undefined}>{Math.round(total * 1000) / 1000}%</strong>
                </li>
              </ul>
            )}
            {total > 0 && total < 100 && <p className="small muted">{`${Math.round((100 - total) * 1000) / 1000}% ${tr("not yet given to anyone.")}`}</p>}
          </section>

          {isManager && (
            <details className="card" open={current.length === 0}>
              <summary>
                <strong>{tr("+ Add a director or shareholder")}</strong>
              </summary>
              <form action={saveDirector} style={{ marginTop: 12 }}>
                <DirectorFields v={{}} />
                <SubmitButton className="btn btn-primary">{tr("Add")}</SubmitButton>
              </form>
            </details>
          )}

          {isManager && (
            <form action={setSharesDecided} className="card">
              <h2>{tr("Shareholding")}</h2>
              <p className="small">
                {st.shares_decided
                  ? `${tr("Decided")}${st.shares_decided_at ? ` ${formatDate(st.shares_decided_at.slice(0, 10))}` : ""}. ${tr("If it changes, file the change with BRELA within the time the law gives.")}`
                  : tr("Not yet decided. Marking it decided needs the percentages of current shareholders, adding up to 100% or less.")}
              </p>
              <input type="hidden" name="decided" value={st.shares_decided ? "0" : "1"} />
              <SubmitButton className={`btn btn-small${st.shares_decided ? "" : " btn-primary"}`}>
                {st.shares_decided ? tr("Mark as not decided") : tr("Mark shares as decided")}
              </SubmitButton>
            </form>
          )}

          {past.length > 0 && (
            <details className="card">
              <summary>
                {tr("Past directors")} ({past.length})
              </summary>
              <ul className="lines">
                {past.map((d) => (
                  <li key={d.id} className="line-head">
                    <span>
                      {d.full_name} <span className="small muted">· {tr(DIRECTOR_ROLES[d.role])}</span>
                    </span>
                    <span className="small muted">
                      {tr("resigned")} {d.resigned_on ? formatDate(d.resigned_on) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <section className="card">
        <h2>{tr("Company facts")}</h2>
        {isManager ? (
          <form action={saveComplianceSettings}>
            <input type="hidden" name="back" value="/compliance/directors" />
            <div className="grid grid-2">
              <div className="field">
                <label htmlFor="incorporated_on">{tr("Incorporated on")}</label>
                <input id="incorporated_on" name="incorporated_on" type="date" defaultValue={st.incorporated_on ?? ""} />
              </div>
              <div className="field">
                <label htmlFor="year_end_month">{tr("Financial year ends in")}</label>
                <select id="year_end_month" name="year_end_month" defaultValue={String(st.year_end_month ?? 12)}>
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {tr(m)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="shareholding_note">{tr("Shareholding notes")}</label>
                <textarea id="shareholding_note" name="shareholding_note" maxLength={4000} defaultValue={st.shareholding_note ?? ""} placeholder={tr("e.g. Four directors to agree the split at the next board meeting")} />
              </div>
              <div className="field" style={{ gridColumn: "1 / -1" }}>
                <label htmlFor="board_note">{tr("Board notes")}</label>
                <textarea id="board_note" name="board_note" maxLength={4000} defaultValue={st.board_note ?? ""} placeholder={tr("Who signs for the company, bank signatories, meeting dates")} />
              </div>
            </div>
            <p className="hint small">{tr("The year end sets the dates of provisional tax, the final return and the audited accounts on the calendar.")}</p>
            <SubmitButton>{tr("Save")}</SubmitButton>
          </form>
        ) : (
          <ul className="lines small">
            <li className="line-head">
              <span className="muted">{tr("Incorporated on")}</span>
              <span>{st.incorporated_on ? formatDate(st.incorporated_on) : "—"}</span>
            </li>
            <li className="line-head">
              <span className="muted">{tr("Financial year ends in")}</span>
              <span>{tr(MONTHS[(st.year_end_month ?? 12) - 1])}</span>
            </li>
          </ul>
        )}
      </section>
      <Disclaimer compact />
    </>
  );
}
