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
          <Link href="/activity" className="tile">
            <div className="tile-title">Activity log</div>
            <div className="tile-sub">Every change, who made it and when</div>
          </Link>
        )}
        {isManager && (
          <Link href="/import" className="tile">
            <div className="tile-title">Import from spreadsheet</div>
            <div className="tile-sub">Clients, suppliers and products from the master data template</div>
          </Link>
        )}
        {isManager && (
          <Link href="/settings/team" className="tile">
            <div className="tile-title">Team &amp; roles</div>
            <div className="tile-sub">Invite people, change roles, switch access off</div>
          </Link>
        )}
        {isManager && (
          <Link href="/settings/go-live" className="tile">
            <div className="tile-title">Go-live checklist</div>
            <div className="tile-sub">What is ready and what is left before everyone starts</div>
          </Link>
        )}
        {isManager && (
          <Link href="/settings/export" className="tile">
            <div className="tile-title">Export data</div>
            <div className="tile-sub">Download everything as Excel (CSV) or one backup file</div>
          </Link>
        )}
        <Link href="/rates" className="tile">
          <div className="tile-title">Exchange rates</div>
          <div className="tile-sub">Company rates for foreign currencies</div>
        </Link>
        <Link href="/notifications#settings" className="tile">
          <div className="tile-title">Your notifications</div>
          <div className="tile-sub">Phone notifications and alert emails for you</div>
        </Link>
        {isManager && (
          <Link href="/settings/notifications" className="tile">
            <div className="tile-title">Alerts setup (server)</div>
            <div className="tile-sub">Connect phone push and email sending</div>
          </Link>
        )}
      </div>
    </>
  );
}
