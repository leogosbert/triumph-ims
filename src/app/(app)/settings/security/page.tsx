import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { StepUpForm } from "@/components/ConfirmIdentity";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { displayName, getAppContext, type Profile } from "@/lib/context";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { EVENT_LABELS, type SecurityEventRow } from "@/lib/securityLabels";
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

type Health = { item: string; status: "ok" | "warn" | "bad" | null; value: number | null; total: number | null; names: string[] | null };

/** One line of the security health check: what it found, and where to fix it. */
function healthLine(h: Health): { title: string; detail?: string; fix?: { href: string; label: string } } {
  const v = h.value ?? 0;
  const t = h.total ?? 0;
  switch (h.item) {
    case "two_step_required":
      return h.status === "ok"
        ? { title: tr("Two-step verification is required for everyone") }
        : {
            title: tr("Two-step verification is not required"),
            detail: tr("With it, a stolen password alone cannot open your company's data."),
            fix: { href: "#two-step", label: tr("Turn it on") },
          };
    case "two_step_coverage":
      return {
        title: `${v} / ${t} ${tr("people use two-step verification")}`,
        detail: h.status === "ok" ? undefined : tr("Ask everyone to turn it on under Your account → Security."),
        fix: h.status === "ok" ? undefined : { href: "#who-two-step", label: tr("See who") },
      };
    case "idle_sign_out":
      return h.status === "ok"
        ? { title: tr("Automatic sign-out is on") }
        : {
            title: tr("Automatic sign-out is off"),
            detail: tr("Signs people out of a phone or computer left open without use."),
            fix: { href: "#idle", label: tr("Set it") },
          };
    case "managers":
      return v <= 1
        ? {
            title: tr("Only one manager"),
            detail: tr("Add a second manager so you are never locked out."),
            fix: { href: "/settings/team", label: tr("Team & roles") },
          }
        : v > 3
          ? {
              title: `${v} ${tr("managers")}`,
              detail: tr("Managers can see and change everything. Keep this to the few people who need it."),
              fix: { href: "/settings/team", label: tr("Team & roles") },
            }
          : { title: `${v} ${tr("managers")}` };
    case "backup":
      return h.status === null
        ? { title: tr("Automatic backups"), detail: tr("Not checked here. See the go-live checklist.") , fix: { href: "/settings/go-live", label: tr("Go-live checklist") } }
        : h.status === "ok"
          ? { title: tr("Automatic backup in the last 2 days") }
          : { title: tr("No automatic backup in the last 2 days"), fix: { href: "/settings/backups", label: tr("Backups") } };
    case "inactive_members":
      return h.status === "ok"
        ? { title: tr("Everyone has signed in within the last 60 days") }
        : {
            title: `${v} ${tr("people have not signed in for 60 days or more")}`,
            detail: `${(h.names ?? []).join(", ")}. ${tr("Consider switching off their access.")}`,
            fix: { href: "/settings/team", label: tr("Team & roles") },
          };
    default:
      return { title: h.item };
  }
}

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

  // Security plus: health check and team sign-ins (hidden until that database update has been run).
  const [{ data: healthData }, { data: eventData }] = await Promise.all([
    supabase.rpc("company_security_health", { p_company: company.id }),
    supabase
      .from("security_events")
      .select("id, user_id, kind, device, ip_hint, created_at")
      .eq("company_id", company.id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const health = (healthData ?? []) as Health[];
  const known = health.filter((h) => h.status !== null);
  const good = known.length > 0 && known.every((h) => h.status === "ok");
  const events = (eventData ?? []) as SecurityEventRow[];
  const ids = Array.from(new Set(events.map((e) => e.user_id).filter((x): x is string => Boolean(x))));
  const { data: peopleData } = ids.length
    ? await supabase.from("profiles").select("id, full_name, email, phone").in("id", ids)
    : { data: [] as Profile[] };
  const people = new Map(((peopleData ?? []) as Profile[]).map((p) => [p.id, p]));

  return (
    <>
      <p className="small">
        <Link href="/settings">{tr("← Settings")}</Link>
      </p>
      <h1>{tr("Security")}</h1>
      <Notice {...notice} />

      {health.length > 0 && (
        <section className="card" id="health">
          <div className="row" style={{ alignItems: "center", marginBottom: 6 }}>
            <h2 style={{ margin: 0, flex: 1 }}>{tr("Security check")}</h2>
            <span className={`badge ${good ? "tone-ok" : "tone-warn"}`}>{good ? tr("Security: Good") : tr("Security: Needs attention")}</span>
          </div>
          <ul className="sec-health">
            {health.map((h) => {
              const line = healthLine(h);
              return (
                <li key={h.item}>
                  <span className={`mark ${h.status ?? ""}`} aria-label={h.status === "ok" ? tr("Good") : h.status ? tr("Needs attention") : tr("Not checked")} />
                  <div className="what">
                    <strong>{line.title}</strong>
                    {line.detail && <span>{line.detail}</span>}
                  </div>
                  {line.fix && (
                    <Link className="btn btn-small" href={line.fix.href}>
                      {line.fix.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <StepUpForm action={saveSecurity}>
        <section className="card" id="two-step">
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

        <section className="card" id="idle">
          <h2>{tr("Automatic sign-out")}</h2>
          <p className="muted small">{tr("Signs people out when the app is left open without use, e.g. on a shared office computer. A warning appears a minute before. The driver screen is not affected, so deliveries can be recorded offline.")}</p>
          <div className="field">
            <label htmlFor="idle_select">{tr("Sign out when idle")}</label>
            <select id="idle_select" name="idle" defaultValue={String(company.idle_timeout_minutes ?? 0)}>
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
            <li>{tr("Sensitive changes (team roles, these settings, bank details, exporting data) ask for the password again.")}</li>
          </ul>
        </section>

        <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Saving…")}>
          {tr("Save security settings")}
        </SubmitButton>
      </StepUpForm>

      {team.length > 0 && (
        <section className="card" id="who-two-step" style={{ marginTop: 16 }}>
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
                  <StepUpForm action={resetMemberMfa}>
                    <input type="hidden" name="membership_id" value={m.membership_id} />
                    <SubmitButton className="btn btn-small" pendingText="…">
                      {tr("Reset")}
                    </SubmitButton>
                  </StepUpForm>
                )}
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ marginBottom: 0 }}>{tr("Reset is for a lost or replaced phone: the person sets up the app again at their next sign-in.")}</p>
        </section>
      )}

      {eventData && (
        <section className="card" id="team-sign-ins">
          <h2>{tr("Team sign-ins")}</h2>
          <p className="muted small">{tr("The last 50 sign-ins and security changes in this company. Look out for new devices or times when nobody should be working.")}</p>
          {events.length === 0 ? (
            <p className="muted small" style={{ margin: 0 }}>{tr("Nothing yet. Sign-ins will appear here.")}</p>
          ) : (
            <ul className="sec-events">
              {events.map((e) => (
                <li key={e.id}>
                  <div className="who">
                    <strong>
                      {displayName(people.get(e.user_id ?? ""))}{" "}
                      {e.kind === "sign_in_new_device" && <span className="badge tone-warn">{tr("New device")}</span>}
                    </strong>
                    <span>
                      {tr(EVENT_LABELS[e.kind] ?? e.kind)} · {e.device ?? tr("Unknown device")}
                      {e.ip_hint ? ` · ${e.ip_hint}` : ""}
                    </span>
                  </div>
                  <span className="when">{formatDateTime(e.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}
