import { primeLang, tr } from "@/lib/tr";
import { StepUpForm } from "@/components/ConfirmIdentity";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { displayName, requireManager, type Profile } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { ROLE_HINTS, ROLE_LABELS, ROLES, type Role } from "@/lib/roles";
import { inviteMember, revokeInvitation, updateMember } from "../actions";
import { Hint, SettingsHead } from "../SettingsHead";

export const metadata = { title: "Team & roles" };

type MemberRow = { id: string; user_id: string; role: Role; active: boolean; created_at: string };
type InviteRow = { id: string; email: string; role: Role; created_at: string };

function RoleSelect({ name, value, id, describedBy }: { name: string; value?: Role; id?: string; describedBy?: string }) {
  return (
    <select id={id} name={name} defaultValue={value ?? ""} required aria-label={tr("Role")} aria-describedby={describedBy}>
      {!value && (
        <option value="" disabled>{tr("Choose a role")}</option>
      )}
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {tr(ROLE_LABELS[r])}
        </option>
      ))}
    </select>
  );
}

export default async function TeamPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, user } = await requireManager();

  const [{ data: memberData }, { data: inviteData }] = await Promise.all([
    supabase
      .from("memberships")
      .select("id, user_id, role, active, created_at")
      .eq("company_id", company.id)
      .order("active", { ascending: false })
      .order("created_at"),
    supabase
      .from("invitations")
      .select("id, email, role, created_at")
      .eq("company_id", company.id)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  ]);
  const members = (memberData ?? []) as MemberRow[];
  const invites = (inviteData ?? []) as InviteRow[];

  const { data: profileData } = await supabase
    .from("profiles")
    .select("id, full_name, email, phone")
    .in(
      "id",
      members.map((m) => m.user_id),
    );
  const profiles = new Map(((profileData ?? []) as Profile[]).map((p) => [p.id, p]));
  const activeCount = members.filter((m) => m.active).length;
  const initials = (p: Profile | undefined) =>
    (displayName(p) || "?")
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join("");

  return (
    <>
      <SettingsHead
        title={tr("Team & roles")}
        icon="team"
        lead={tr("Invite people, give each one a role, and switch access off when someone leaves. Nothing they recorded is lost.")}
      />
      <Notice {...notice} />

      <section className="card" id="invite">
        <h2>{tr("Invite someone")}</h2>
        <p className="st-card-lead">{tr("Ask them to open the app and create an account with this email. They will be offered to join.")}</p>
        <form action={inviteMember} className="st-form">
          <div className="grid grid-2">
            <div className="field">
              <label htmlFor="email">{tr("Their email")}</label>
              <input id="email" name="email" type="email" inputMode="email" autoComplete="off" required placeholder="name@company.co.tz" />
            </div>
            <div className="field">
              <label htmlFor="role">{tr("Role")}</label>
              <RoleSelect id="role" name="role" describedBy="role-hint" />
              <Hint id="role-hint">{tr("The role decides what they can see and change. You can change it later.")}</Hint>
            </div>
          </div>
          <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Inviting…")}>{tr("Invite")}</SubmitButton>
        </form>
        <details style={{ marginTop: 12 }}>
          <summary className="small">{tr("What can each role do?")}</summary>
          <ul className="small muted">
            {ROLES.map((r) => (
              <li key={r}>
                <strong>{tr(ROLE_LABELS[r])}:</strong> {tr(ROLE_HINTS[r])}
              </li>
            ))}
          </ul>
        </details>
      </section>

      {invites.length > 0 && (
        <section className="card" id="waiting">
          <div className="st-card-head">
            <h2>{tr("Waiting to join")}</h2>
            <span className="badge tone-warn">{invites.length}</span>
          </div>
          <ul className="list st-rows">
            {invites.map((i) => (
              <li key={i.id} className="row">
                <div>
                  <strong>{i.email}</strong>
                  <div className="muted small">
                    {tr(ROLE_LABELS[i.role])}{" "}{tr("· invited")}{" "}{formatDate(i.created_at)}
                  </div>
                </div>
                <form action={revokeInvitation}>
                  <input type="hidden" name="invitation_id" value={i.id} />
                  <SubmitButton className="btn btn-small btn-danger" pendingText={tr("Cancelling…")}>{tr("Cancel")}</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card" id="members">
        <div className="st-card-head">
          <h2>{tr("Team")}</h2>
          <span className="badge tone-ok">{tr("{n} active").replace("{n}", String(activeCount))}</span>
        </div>
        <p className="st-card-lead">{tr("Change a role or switch access off, then press Update. You may be asked for your password.")}</p>
        <ul className="list">
          {members.map((m) => {
            const p = profiles.get(m.user_id);
            return (
              <li key={m.id}>
                <div className="st-person">
                  <span className="st-avatar" aria-hidden>
                    {initials(p)}
                  </span>
                  <div className="st-person-text">
                    <strong>{displayName(p)}</strong> {m.user_id === user.id && <span className="badge">{tr("You")}</span>}{" "}
                    {!m.active && <span className="badge off">{tr("Switched off")}</span>}
                    <div className="muted small">{p?.email}</div>
                  </div>
                </div>
                <StepUpForm action={updateMember} className="st-member-form">
                  <input type="hidden" name="membership_id" value={m.id} />
                  <RoleSelect name="role" value={m.role} />
                  <select name="active" defaultValue={String(m.active)} aria-label={tr("Access")}>
                    <option value="true">{tr("Has access")}</option>
                    <option value="false">{tr("Switched off")}</option>
                  </select>
                  <SubmitButton className="btn btn-small">{tr("Update")}</SubmitButton>
                </StepUpForm>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
