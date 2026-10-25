"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { shrinkImage } from "@/lib/image";
import { createClient } from "@/lib/supabase/client";
import { useTr } from "@/lib/tr-client";
import { setCataloguePhoto } from "../actions";

const TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Photo for the public catalogue: shrunk in the browser, stored in the public "catalogue" bucket. */
export function PhotoUpload({ companyId, productId, hasPhoto }: { companyId: string; productId: string; hasPhoto: boolean }) {
  const tr = useTr();
  const router = useRouter();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    if (!TYPES.includes(file.type)) return setError(tr("Choose a JPG, PNG or WebP photo."));
    setBusy(true);
    try {
      const shrunk = await shrinkImage(file, 1200, 0.82);
      if (shrunk.blob.size > 3 * 1024 * 1024) throw new Error(tr("The photo must be smaller than 3 MB."));
      const path = `${companyId}/${productId}/${Date.now()}.${shrunk.ext === "bin" ? "jpg" : shrunk.ext}`;
      const { error: up } = await createClient().storage.from("catalogue").upload(path, shrunk.blob, { contentType: shrunk.type, upsert: false });
      if (up) throw new Error(`${tr("Upload failed")}: ${up.message}`);
      const res = await setCataloguePhoto(productId, path);
      if (res.error) throw new Error(tr(res.error));
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    setBusy(true);
    const res = await setCataloguePhoto(productId, null);
    setBusy(false);
    if (res.error) setError(tr(res.error));
    else router.refresh();
  }

  return (
    <span className="gt-share">
      <input ref={ref} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={onPick} />
      <button type="button" className="btn btn-small" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? "…" : hasPhoto ? tr("Change photo") : tr("Add photo")}
      </button>
      {hasPhoto && !busy && (
        <button type="button" className="btn btn-small btn-ghost" onClick={onRemove}>
          {tr("Remove photo")}
        </button>
      )}
      {error && <span className="small text-warn">{error}</span>}
    </span>
  );
}
