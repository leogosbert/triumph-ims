import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { loadBackupStatus, type BackupStatus } from "@/lib/backups";
import { getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { LEVELS } from "@/lib/levels";
import { outboxStatus } from "@/lib/outbox";
import { SettingsHead } from "./SettingsHead";
import { hasRole } from "@/lib/roles";

export const metadata = { title: "Settings" };

type Chip = { text: string; tone: "ok" | "warn" | "bad" | "info" | "off" };
type Item = { href: string; icon: IconName; title: string; sub: string; chip?: Chip | null; show: boolean };

function Entry({ i }: { i: Item }) {
  return (
    <Link href={i.href} className="st-item">
      <span className="st-item-ico" aria-hidden>
        <Icon name={i.icon} size={21} />
      </span>
      <span className="st-item-body">
        <span className="st-item-title">{i.title}</span>
        <span className="st-item-sub">{i.sub}</span>
        {i.chip && <span className={`badge tone-${i.chip.tone}`}>{i.chip.text}</span>}
      </span>
      <span className="st-item-chev" aria-hidden>
        <Icon name="chevron" size={18} />
      </span>
    </Link>
  );
}

const fill = (s: string, vars: Record<string, string | number>) =>
  Object.entries(vars).reduce((acc, [k, v]) => acc.replace(`{${k}}`, String(v)), s);

export default async function SettingsPage() {
  await primeLang();
  const { supabase, company, isManager, features, roles } = await getAppContext();
  const on = features.on;
  const showTeam = isManager && on("team");
  const showBackups = isManager && on("data_export");

  // Small status chips: two cheap queries, run together.
  const [members, invites, backup] = await Promise.all([
    showTeam
      ? supabase.from("memberships").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("active", true)
      : null,
    showTeam
      ? supabase
          .from("invitations")
          .select("id", { count: "exact", head: true })
          .eq("company_id", company.id)
          .is("accepted_at", null)
          .is("revoked_at", null)
      : null,
    showBackups ? loadBackupStatus(supabase, company.id) : Promise.resolve<BackupStatus | null>(null),
  ]);

  // Company profile: the details that appear on quotations and invoices.
  const profileFields = [company.tin, company.vrn, company.address, company.phone, company.email, company.logo_path, company.bank_details];
  const missing = profileFields.filter((v) => !v).length;
  const companyChip: Chip | null = !isManager
    ? null
    : missing === 0
      ? { text: tr("Complete"), tone: "ok" }
      : { text: fill(tr("{n} details to fill in"), { n: missing }), tone: "warn" };

  const teamChip: Chip | null =
    members?.count != null
      ? {
          text:
            fill(tr("{n} active"), { n: members.count }) +
            (invites?.count ? ` · ${fill(tr("{n} waiting to join"), { n: invites.count })}` : ""),
          tone: "info",
        }
      : null;

  const mfaChip: Chip | null =
    company.require_mfa === undefined
      ? null
      : company.require_mfa
        ? { text: tr("Two-step: on"), tone: "ok" }
        : { text: tr("Two-step: off"), tone: "warn" };

  const levelChip: Chip | null =
    features.ready && company.business_level
      ? { text: fill(tr("Level: {level}"), { level: tr(LEVELS[company.business_level].name) }), tone: "info" }
      : null;

  const backupChip: Chip | null = !backup
    ? null
    : backup.is_demo
      ? { text: tr("Not backed up (demo)"), tone: "off" }
      : backup.overdue
        ? { text: tr("Backup overdue"), tone: "bad" }
        : backup.last_any_at
          ? { text: fill(tr("Last backup: {date}"), { date: formatDate(backup.last_any_at) }), tone: "ok" }
          : { text: tr("First backup tonight"), tone: "info" };

  const alerts = isManager ? outboxStatus() : null;
  const connected = alerts ? [alerts.secret, alerts.push, alerts.email].filter(Boolean).length : 0;
  const alertsChip: Chip | null = alerts
    ? { text: fill(tr("{n} of 3 connected"), { n: connected }), tone: connected === 3 ? "ok" : "warn" }
    : null;

  const groups: { title: string; items: Item[] }[] = [
    {
      title: tr("Company"),
      items: [
        {
          href: "/settings/company",
          icon: "building",
          title: tr("Company details & branding"),
          sub: isManager ? tr("Name, TIN, VRN, logo, colours, bank details") : tr("View your company's details"),
          chip: companyChip,
          show: true,
        },
        {
          href: "/settings/billing",
          icon: "receipt",
          title: tr("Plan & billing"),
          sub: tr("Your LeMoSp plan, invoices from LeMo Tech and how to pay"),
          show: hasRole(roles, "management") || hasRole(roles, "finance"),
        },
        {
          href: "/services",
          icon: "inbox",
          title: tr("Services & prices"),
          sub: tr("Training, setup, add-ons and playbooks from LeMo Tech"),
          show: true,
        },
        {
          href: "/rates",
          icon: "cash",
          title: tr("Exchange rates"),
          sub: tr("Company rates for foreign currencies"),
          show: on("multi_currency"),
        },
      ],
    },
    {
      title: tr("People & security"),
      items: [
        {
          href: "/settings/team",
          icon: "team",
          title: tr("Team & roles"),
          sub: tr("Invite people, change roles, switch access off"),
          chip: teamChip,
          show: showTeam,
        },
        {
          href: "/settings/security",
          icon: "lock",
          title: tr("Security"),
          sub: tr("Two-step verification, automatic sign-out, password rules"),
          chip: mfaChip,
          show: isManager && on("security_policy"),
        },
        {
          href: "/account",
          icon: "user",
          title: tr("Your account"),
          sub: tr("Your name, password, appearance and language"),
          show: true,
        },
      ],
    },
    {
      title: tr("Features & growth"),
      items: [
        {
          href: "/settings/features",
          icon: "settings",
          title: tr("Features & business level"),
          sub: tr("Switch features on or off, change your level"),
          chip: levelChip,
          show: isManager,
        },
        {
          href: "/growth",
          icon: "report",
          title: tr("Growth & recommendations"),
          sub: tr("Your business level and features that could help"),
          show: isManager,
        },
        {
          href: "/settings/go-live",
          icon: "check",
          title: tr("Go-live checklist"),
          sub: tr("What is ready and what is left before everyone starts"),
          show: isManager,
        },
      ],
    },
    {
      title: tr("Data & backups"),
      items: [
        {
          href: "/settings/backups",
          icon: "inbox",
          title: tr("Backups"),
          sub: tr("Automatic daily copies of your data, back up now, download"),
          chip: backupChip,
          show: showBackups,
        },
        {
          href: "/settings/export",
          icon: "doc",
          title: tr("Export data"),
          sub: tr("Download everything as Excel (CSV) or one backup file"),
          show: isManager && on("data_export"),
        },
        {
          href: "/integrations",
          icon: "upload",
          title: tr("Integrations & API"),
          sub: tr("Accounting export, API keys for other systems"),
          show: isManager && on("integrations"),
        },
        {
          href: "/import",
          icon: "upload",
          title: tr("Import from spreadsheet"),
          sub: tr("Clients, suppliers and products from the master data template"),
          show: isManager,
        },
        {
          href: "/activity",
          icon: "receipt",
          title: tr("Activity log"),
          sub: tr("Every change, who made it and when"),
          show: isManager && on("activity"),
        },
      ],
    },
    {
      title: tr("Alerts"),
      items: [
        {
          href: "/notifications#settings",
          icon: "bell",
          title: tr("Your notifications"),
          sub: tr("Phone notifications and alert emails for you"),
          show: on("notifications"),
        },
        {
          href: "/settings/notifications",
          icon: "activity",
          title: tr("Alerts setup (server)"),
          sub: tr("Connect phone push and email sending"),
          chip: alertsChip,
          show: isManager,
        },
      ],
    },
  ];

  return (
    <>
      <SettingsHead title={tr("Settings")} icon="settings" back={null} lead={tr("Set up your company, your team and how the app works for you.")} />
      <p className="st-company-line">
        <strong>{company.name}</strong>
        {!isManager && <> · {tr("Only management can change company settings.")}</>}
      </p>
      {groups.map((g) => {
        const items = g.items.filter((i) => i.show);
        if (items.length === 0) return null;
        return (
          <section key={g.title} className="st-group" aria-label={g.title}>
            <h2 className="st-group-title">{g.title}</h2>
            <div className="st-items">
              {items.map((i) => (
                <Entry key={i.href} i={i} />
              ))}
            </div>
          </section>
        );
      })}
    </>
  );
}
