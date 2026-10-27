import { redirect } from "next/navigation";
import { tr } from "@/lib/tr";
import { SubmitButton } from "@/components/SubmitButton";
import { portalRpc, readSession } from "@/lib/portal/server";
import type { PortalAccountRow } from "@/lib/portal/types";
import { AuthCard } from "../_c/AuthCard";
import { chooseAccount, signOut } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose" };

/** One email can be a contact of several companies (or a client and a supplier): choose which. */
export default async function PortalChoose() {
  const { session } = await readSession();
  if (!session) redirect("/portal/login");
  let accounts: PortalAccountRow[] = [];
  try {
    accounts = await portalRpc<PortalAccountRow[]>("portal_accounts", { p_session: session });
  } catch {
    redirect("/portal/login?expired=1");
  }
  return (
    <AuthCard title="Choose a portal">
      {accounts.length === 0 ? (
        <p className="notice notice-error">{tr("This email no longer has portal access. Ask your contact at the company.")}</p>
      ) : (
        <ul className="list portal-choose">
          {accounts.map((a) => (
            <li key={a.id}>
              <form action={chooseAccount}>
                <input type="hidden" name="account" value={a.id} />
                <SubmitButton className="btn btn-block portal-choose-btn" pendingText={tr("Opening…")}>
                  <strong>{a.company}</strong>
                  <span className="small muted">
                    {a.party === "client" ? tr("Client portal") : tr("Supplier portal")} · {a.party_name}
                  </span>
                </SubmitButton>
              </form>
            </li>
          ))}
        </ul>
      )}
      <form action={signOut} style={{ marginTop: 12 }}>
        <button type="submit" className="btn btn-small">{tr("Sign out")}</button>
      </form>
    </AuthCard>
  );
}
