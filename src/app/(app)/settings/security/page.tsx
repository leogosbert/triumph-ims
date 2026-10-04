import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { resetMemberMfa, saveSecurity } from "./actions";
import type { Key } from "@/lib/i18n";
import { getDict } from "@/lib/lang";

export const metadata = { title: "Security" };

const IDLE = [
  { v: 0, label: "Never" },
  { v: 15, label: "After 15 minutes" },
  { v: 30, label: "After 30 minutes" },
  { v: 60, label: "After 1 hour" },
  { v: 120, label: "After 2 hours" },
  { v: 240, label: "After 4 hours" },
  { v: 480, label: "After 8 hours" },
];

export default async function SecuritySettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, isManager } = await getAppContext();
  if (!isManager) redirect("/");
  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  const meWithCode = aal?.currentLevel === "aal2";
  const { t } = await getDict();
  type Row = { membership_id: string; user_id: string; full_name: string | null; email: string | null; role: string; has_mfa: boolean };
  const { data: teamData } = meWithCode || !company.require_mfa ? await supabase.rpc("team_mfa_status", { p_company: company.id }) : { data: null };
  const team = (teamData ?? []) as Row[];
  const withCode = team.filter((m) => m.has_mfa).length;

  return (
    <>
      <p className="small">
        <Link href="/settings">{tr("← Settings")}</Link>
      </p>
      <h1>{tr("Security")}</h1>
      <Notice {...notice} />
      <form action={saveSecurity}>
        <section className="card">
          <h2>{tr("Two-step verification for everyone")}</h2>
          <p className="muted small">
            {tr("When this is on, everyone in")} {company.name}{" "}
            {tr("must enter a code from an authenticator app after their password. The database itself refuses access without it, so once someone has set up their app, a stolen password is not enough.")}
          </p>
          <label className="check" style={{ fontWeight: 600 }}>
            <input type="checkbox" name="require_mfa" defaultChecked={Boolean(company.require_mfa)} disabled={!meWithCode && !company.require_mfa} />{" "}
            {tr("Require two-step verification")}
          </label>
          {!meWithCode && !company.require_mfa && (
            <p className="small muted" style={{ marginBottom: 0 }}>
              {tr("First turn it on for yourself under")} <Link href="/account#security">{tr("Your account → Security")}</Link>{" "}
              {tr("and sign in with your code. Then you can require it for everyone.")}
            </p>
          )}
        </section>

        {team.length > 0 && (
          <section className="card">
            <h2>{tr("Who has two-step on")}</h2>
            <p className="muted small">
              {withCode} / {team.length}{" "}
              {tr("people. Ask everyone to turn it on under Your account → Security before you require it: anyone without it will be asked to set it up at their next sign-in.")}
            </p>
            <ul className="list">
              {team.map((m) => (
                <li key={m.membership_id} className="row">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>{m.full_name || m.email}</strong>
                    <div className="muted small">{t[`role.${m.role}` as Key]}</div>
                  </div>
                  <span className={`badge ${m.has_mfa ? "tone-ok" : "tone-warn"}`}>{m.has_mfa ? tr("On") : tr("Off")}</span>
                  {m.has_mfa && (
                    <form action={resetMemberMfa}>
                      <input type="hidden" name="membership_id" value={m.membership_id} />
                      <SubmitButton className="btn btn-small" pendingText="…">
                        {tr("Reset")}
                      </SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            <p className="small muted" style={{ marginBottom: 0 }}>{tr("Reset is for a lost or replaced phone: the person sets up the app again at their next sign-in.")}</p>
          </section>
        )}

        <section className="card">
          <h2>{tr("Automatic sign-out")}</h2>
          <p className="muted small">{tr("Signs people out when the app is left open without use, e.g. on a shared office computer. A warning appears a minute before. The driver screen is not affected, so deliveries can be recorded offline.")}</p>
          <div className="field">
            <label htmlFor="idle">{tr("Sign out when idle")}</label>
            <select id="idle" name="idle" defaultValue={String(company.idle_timeout_minutes ?? 0)}>
              {IDLE.map((o) => (
                <option key={o.v} value={o.v}>
                  {tr(o.label)}
                </option>
              ))}
            </select>
          </div>
        </section>

        <section className="card">
          <h2>{tr("Passwords")}</h2>
          <ul className="small muted" style={{ margin: 0, paddingLeft: 18 }}>
            <li>{tr("New passwords need at least 10 characters and a mix of letters, numbers and symbols.")}</li>
            <li>{tr("Common passwords and passwords found in data breaches are refused.")}</li>
            <li>{tr("Too many wrong sign-in attempts are slowed down automatically.")}</li>
          </ul>
        </section>

        <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Saving…")}>
          {tr("Save security settings")}
        </SubmitButton>
      </form>
    </>
  );
}
