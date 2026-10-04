import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { getAppContext } from "@/lib/context";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await primeLang();
  const { company, isManager } = await getAppContext();
  return (
    <>
      <h1>{tr("Settings")}</h1>
      <div className="grid">
        <Link href="/settings/company" className="tile">
          <div className="tile-title">{tr("Company details & branding")}</div>
          <div className="tile-sub">
            {isManager ? tr("Name, TIN, VRN, logo, colours, bank details") : `View ${company.name}'s details`}
          </div>
        </Link>
        {isManager && (
          <Link href="/activity" className="tile">
            <div className="tile-title">{tr("Activity log")}</div>
            <div className="tile-sub">{tr("Every change, who made it and when")}</div>
          </Link>
        )}
        {isManager && (
          <Link href="/import" className="tile">
            <div className="tile-title">{tr("Import from spreadsheet")}</div>
            <div className="tile-sub">{tr("Clients, suppliers and products from the master data template")}</div>
          </Link>
        )}
        {isManager && (
          <Link href="/settings/security" className="tile">
            <div className="tile-title">{tr("Security")}</div>
            <div className="tile-sub">{tr("Two-step verification, automatic sign-out, password rules")}</div>
          </Link>
        )}
        {isManager && (
          <Link href="/settings/team" className="tile">
            <div className="tile-title">{tr("Team & roles")}</div>
            <div className="tile-sub">{tr("Invite people, change roles, switch access off")}</div>
          </Link>
        )}
        {isManager && (
          <Link href="/settings/go-live" className="tile">
            <div className="tile-title">{tr("Go-live checklist")}</div>
            <div className="tile-sub">{tr("What is ready and what is left before everyone starts")}</div>
          </Link>
        )}
        {isManager && (
          <Link href="/settings/export" className="tile">
            <div className="tile-title">{tr("Export data")}</div>
            <div className="tile-sub">{tr("Download everything as Excel (CSV) or one backup file")}</div>
          </Link>
        )}
        <Link href="/rates" className="tile">
          <div className="tile-title">{tr("Exchange rates")}</div>
          <div className="tile-sub">{tr("Company rates for foreign currencies")}</div>
        </Link>
        <Link href="/notifications#settings" className="tile">
          <div className="tile-title">{tr("Your notifications")}</div>
          <div className="tile-sub">{tr("Phone notifications and alert emails for you")}</div>
        </Link>
        {isManager && (
          <Link href="/settings/notifications" className="tile">
            <div className="tile-title">{tr("Alerts setup (server)")}</div>
            <div className="tile-sub">{tr("Connect phone push and email sending")}</div>
          </Link>
        )}
      </div>
    </>
  );
}
