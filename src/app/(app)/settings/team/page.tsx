import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { StepUpForm } from "@/components/ConfirmIdentity";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { displayName, requireManager, type Profile } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { ROLE_HINTS, ROLE_LABELS, ROLES, type Role } from "@/lib/roles";
import { inviteMember, revokeInvitation, updateMember } from "../actions";

export const metadata = { title: "Team & roles" };

type MemberRow = { id: string; user_id: string; role: Role; active: boolean; created_at: string };
type InviteRow = { id: string; email: string; role: Role; created_at: string };

function RoleSelect({ name, value }: { name: string; value?: Role }) {
  return (
    <select name={name} defaultValue={value ?? ""} required aria-label={tr("Role")}>
      {!value && (
        <option value="" disabled>{tr("Choose a role")}</option>
      )}
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {ROLE_LABELS[r]}
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

  return (
    <>
      <p className="small">
        <Link href="/settings">{tr("← Settings")}</Link>
      </p>
      <h1>{tr("Team & roles")}</h1>
      <Notice {...notice} />

      <section className="card">
        <h2>{tr("Invite someone")}</h2>
        <form action={inviteMember}>
          <div className="field">
            <label htmlFor="email">{tr("Their email")}</label>
            <input id="email" name="email" type="email" required placeholder={tr("name@company.co.tz")} />
          </div>
          <div className="field">
            <label htmlFor="role">{tr("Role")}</label>
            <RoleSelect name="role" />
          </div>
          <SubmitButton pendingText={tr("Inviting…")}>{tr("Invite")}</SubmitButton>
        </form>
        <details style={{ marginTop: 12 }}>
          <summary className="small">{tr("What can each role do?")}</summary>
          <ul className="small muted">
            {ROLES.map((r) => (
              <li key={r}>
                <strong>{ROLE_LABELS[r]}:</strong> {ROLE_HINTS[r]}
              </li>
            ))}
          </ul>
        </details>
      </section>

      {invites.length > 0 && (
        <section className="card">
          <h2>{tr("Waiting to join")}</h2>
          <ul className="list">
            {invites.map((i) => (
              <li key={i.id} className="row">
                <div>
                  <strong>{i.email}</strong>
                  <div className="muted small">
                    {ROLE_LABELS[i.role]}{" "}{tr("· invited")}{" "}{formatDate(i.created_at)}
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

      <section className="card">
        <h2>{tr("Team (")}{members.filter((m) => m.active).length}{" "}{tr("active)")}</h2>
        <ul className="list">
          {members.map((m) => {
            const p = profiles.get(m.user_id);
            return (
              <li key={m.id}>
                <div className="row" style={{ marginBottom: 8 }}>
                  <div>
                    <strong>{displayName(p)}</strong> {m.user_id === user.id && <span className="badge">{tr("You")}</span>}{" "}
                    {!m.active && <span className="badge off">{tr("Switched off")}</span>}
                    <div className="muted small">{p?.email}</div>
                  </div>
                </div>
                <StepUpForm action={updateMember} className="inline-form">
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
