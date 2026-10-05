import type { createClient } from "@/lib/supabase/server";
import type { TowerItem } from "@/lib/dashboard";

type Supabase = Awaited<ReturnType<typeof createClient>>;

export type BackupKind = "daily" | "weekly" | "monthly" | "manual";

export type BackupRow = {
  id: string;
  kind: BackupKind;
  taken_at: string;
  tables: number;
  rows: number;
  bytes: number;
  checksum: string;
  warnings: string[];
  created_by: string | null;
};

export type BackupStatus = {
  last_auto_at: string | null;
  last_any_at: string | null;
  overdue: boolean;
  last_attempt_failed: boolean;
  last_attempt_at: string | null;
  manual_today: number;
  manual_limit: number;
  is_demo: boolean;
};

export const KIND_LABEL: Record<BackupKind, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  manual: "By hand",
};

/** How many copies of each kind are kept (same numbers as prune_company_backups in the database). */
export const KEEP: Record<BackupKind, number> = { daily: 7, weekly: 5, monthly: 12, manual: 10 };

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/** Status for managers; null before the backups SQL has been run (or for non-managers). */
export async function loadBackupStatus(supabase: Supabase, companyId: string): Promise<BackupStatus | null> {
  try {
    const { data, error } = await supabase.rpc("company_backup_status", { p_company: companyId });
    if (error || !data) return null;
    return data as BackupStatus;
  } catch {
    return null;
  }
}

/**
 * Home "control tower" line for managers when the last automatic backup is more than 2 days old.
 * The label is English: translate it with tr() before showing it.
 */
export async function backupTowerItem(supabase: Supabase, companyId: string): Promise<TowerItem | null> {
  const s = await loadBackupStatus(supabase, companyId);
  if (!s || s.is_demo || !s.overdue) return null;
  return { label: "automatic backup overdue", count: 1, href: "/settings/backups" };
}

/** File name for a download: LeMoSp-backup-<company>-<date>.json */
export function backupFileName(companyName: string, takenAt: string): string {
  const slug = companyName.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "company";
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date(takenAt));
  return `LeMoSp-backup-${slug}-${day}.json`;
}
