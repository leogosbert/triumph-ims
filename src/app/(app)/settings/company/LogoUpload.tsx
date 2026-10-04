"use client";

import { useTr } from "@/lib/tr-client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { setLogo } from "../actions";

const TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_BYTES = 1024 * 1024;

export function LogoUpload({ companyId, currentUrl }: { companyId: string; currentUrl: string | null }) {
  const tr = useTr();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = TYPES[file.type];
    if (!ext) return setError("Please choose a PNG, JPG or WebP image.");
    if (file.size > MAX_BYTES) return setError("The logo must be smaller than 1 MB.");

    setBusy(true);
    const path = `${companyId}/logo-${Date.now()}.${ext}`;
    const { error: upErr } = await createClient()
      .storage.from("branding")
      .upload(path, file, { contentType: file.type, cacheControl: "31536000", upsert: false });
    if (upErr) {
      setBusy(false);
      return setError(`Upload failed: ${upErr.message}`);
    }
    const res = await setLogo(path);
    setBusy(false);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  async function onRemove() {
    setBusy(true);
    const res = await setLogo(null);
    setBusy(false);
    if (res.error) return setError(res.error);
    router.refresh();
  }

  return (
    <div>
      <div className="logo-preview">
        {currentUrl ? <img src={currentUrl} alt={tr("Company logo")} /> : <div className="empty">{tr("No logo")}</div>}
        <div className="actions" style={{ marginTop: 0 }}>
          <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? tr("Working…") : currentUrl ? tr("Replace logo") : tr("Upload logo")}
          </button>
          {currentUrl && (
            <button type="button" className="btn btn-danger" disabled={busy} onClick={onRemove}>{tr("Remove")}</button>
          )}
        </div>
      </div>
      <p className="hint" style={{ marginTop: 8 }}>{tr("PNG, JPG or WebP, under 1 MB. A square logo on a white or transparent background works best.")}</p>
      {error && <p className="notice notice-error">{error}</p>}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPick} />
    </div>
  );
}
