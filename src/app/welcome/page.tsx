import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { acceptInvitation, createCompany, signOut } from "@/app/actions";
import { readNotice, type SearchParams } from "@/lib/messages";
import { ROLE_LABELS, type Role } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Welcome" };

type Invitation = { id: string; company_id: string; company_name: string; role: Role; created_at: string };

export default async function WelcomePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count } = await supabase
    .from("memberships")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .eq("active", true);
  if ((count ?? 0) > 0) redirect("/");

  const { data } = await supabase.rpc("my_invitations");
  const invitations = (data ?? []) as Invitation[];

  return (
    <div className="auth-wrap">
      <img className="auth-logo" src="/brand/lemo-sm-on-dark.svg" alt={tr("LeMoSp")} />
      <div className="auth-card">
        <div className="brand">
          <div>
            <h1 style={{ margin: 0 }}>{tr("Welcome")}</h1>
            <span className="muted small">{user.email}</span>
          </div>
        </div>

        <Notice {...notice} />

        {invitations.length > 0 && (
          <section className="card">
            <h2>{tr("You've been invited")}</h2>
            <ul className="list">
              {invitations.map((inv) => (
                <li key={inv.id} className="row">
                  <div>
                    <strong>{inv.company_name}</strong>
                    <div className="muted small">{tr("as")}{" "}{ROLE_LABELS[inv.role]}</div>
                  </div>
                  <form action={acceptInvitation}>
                    <input type="hidden" name="invitation_id" value={inv.id} />
                    <SubmitButton pendingText={tr("Joining…")}>{tr("Join")}</SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2>{invitations.length > 0 ? tr("Or set up a new company") : tr("Set up your company")}</h2>
          <p className="muted small">{tr("You'll be its first manager and can invite your team afterwards. If your company already uses this app, ask a manager to invite")}{" "}<strong>{user.email}</strong>{" "}{tr("instead.")}</p>
          <form action={createCompany}>
            <div className="field">
              <label htmlFor="name">{tr("Company name")}</label>
              <input id="name" name="name" type="text" placeholder={tr("e.g. TRIUMPH General Suppliers Ltd")} required />
            </div>
            <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Setting up…")}>{tr("Create company")}</SubmitButton>
          </form>
        </section>

        <form action={signOut} style={{ marginTop: 16, textAlign: "center" }}>
          <button className="btn btn-small" type="submit">{tr("Sign out")}</button>
        </form>
      </div>
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
