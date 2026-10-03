import Link from "next/link";
import { getAppContext } from "@/lib/context";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { company, isManager } = await getAppContext();
  return (
    <>
      <h1>Settings</h1>
      <div className="grid">
        <Link href="/settings/company" className="tile">
          <div className="tile-title">Company details &amp; branding</div>
          <div className="tile-sub">
            {isManager ? "Name, TIN, VRN, logo, colours, bank details" : `View ${company.name}'s details`}
          </div>
        </Link>
        {isManager && (
          <Link href="/settings/team" className="tile">
            <div className="tile-title">Team &amp; roles</div>
            <div className="tile-sub">Invite people, change roles, switch access off</div>
          </Link>
        )}
      </div>
    </>
  );
}
