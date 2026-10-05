"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useTr } from "@/lib/tr-client";

type Folder = { id: string; bucket: string; prefix: string };

/** Every file path under a folder ("<company>/"), going into sub-folders. */
async function listAll(supabase: ReturnType<typeof createClient>, bucket: string, folder: string): Promise<string[]> {
  const out: string[] = [];
  const queue = [folder.replace(/\/+$/, "")];
  while (queue.length) {
    const dir = queue.shift()!;
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await supabase.storage.from(bucket).list(dir, { limit: 100, offset });
      if (error) throw new Error(error.message);
      const items = data ?? [];
      for (const it of items) {
        // Folders have no id; files do.
        if (it.id) out.push(`${dir}/${it.name}`);
        else queue.push(`${dir}/${it.name}`);
      }
      if (items.length < 100) break;
    }
  }
  return out;
}

/**
 * "Remove files": deletes the files of closed companies with the admin's own session (the
 * storage rules allow it only for the folders still listed), then marks each folder done.
 */
export function RemoveFiles({ folders }: { folders: Folder[] }) {
  const tr = useTr();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setBusy(true);
    setMsg(null);
    const supabase = createClient();
    let removed = 0;
    let failed = 0;
    for (const f of folders) {
      try {
        const paths = await listAll(supabase, f.bucket, f.prefix);
        for (let i = 0; i < paths.length; i += 100) {
          const { error } = await supabase.storage.from(f.bucket).remove(paths.slice(i, i + 100));
          if (error) throw new Error(error.message);
          removed += Math.min(100, paths.length - i);
        }
        const { error } = await supabase.rpc("mark_storage_cleanup_done", { p_id: f.id });
        if (error) throw new Error(error.message);
      } catch {
        failed++;
      }
    }
    setBusy(false);
    setMsg(
      failed
        ? { ok: false, text: `${tr("Some folders could not be cleared. Press Remove files again.")} (${failed})` }
        : { ok: true, text: `${tr("Files removed:")} ${removed}` },
    );
    router.refresh();
  }

  return (
    <div>
      <button type="button" className="btn btn-primary" disabled={busy || folders.length === 0} onClick={() => void run()}>
        {busy ? tr("Removing…") : tr("Remove files")}
      </button>
      {msg && (
        <p className={`notice ${msg.ok ? "notice-ok" : "notice-error"}`} role="status" style={{ marginBottom: 0 }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
