import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { LEVEL_LABEL, LEVELS } from "@/components/suggestions/meta";
import { readNotice, type SearchParams } from "@/lib/messages";
import { saveFeature } from "../../actions";
import { platformAdmin } from "../../guard";
import { loadCategories } from "../../categories";
import { TutorialEditor } from "../TutorialEditor";

export const metadata = { title: "Feature" };

type Feature = {
  key: string;
  name: string;
  description: string | null;
  module: string | null;
  default_level: string;
  status: string;
  audience: string | null;
  benefits: string | null;
  tutorial: unknown;
  route: string | null;
  sort: number;
  active: boolean;
};

export default async function AdminFeaturePage({ params, searchParams }: { params: Promise<{ key: string }>; searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const { key: rawKey } = await params;
  const key = decodeURIComponent(rawKey);
  const notice = await readNotice(searchParams);
  const isNew = key === "new";

  let f: Feature | null = null;
  if (!isNew) {
    const { data } = await admin.supabase.from("features").select("*").eq("key", key).maybeSingle();
    f = (data as Feature | null) ?? null;
    if (!f) {
      return (
        <>
          <p className="small">
            <Link href="/admin/features">{tr("← Features")}</Link>
          </p>
          <p className="card muted">{tr("Feature not found.")}</p>
        </>
      );
    }
  }
  const tutorial = (Array.isArray(f?.tutorial) ? (f!.tutorial as { title?: string; body?: string }[]) : []).map((s) => ({
    title: String(s?.title ?? ""),
    body: String(s?.body ?? ""),
  }));
  const names = (await loadCategories(admin.supabase)).list.map((c) => c.name);
  const modules = f?.module && !names.includes(f.module) ? [...names, f.module] : names;

  return (
    <>
      <p className="small">
        <Link href="/admin/features">{tr("← Features")}</Link>
      </p>
      <h2 className="adm-title">{isNew ? tr("New feature") : f!.name}</h2>
      <Notice {...notice} />
      <form action={saveFeature}>
        <input type="hidden" name="is_new" value={isNew ? "1" : "0"} />
        <section className="card">
          <h2>{tr("Basics")}</h2>
          <div className="field">
            <label htmlFor="f-key">{tr("Key")}</label>
            {isNew ? (
              <input id="f-key" name="key" required pattern="[a-z][a-z0-9_]{1,49}" placeholder="stock_transfers" />
            ) : (
              <>
                <input id="f-key" value={f!.key} disabled />
                <input type="hidden" name="key" value={f!.key} />
              </>
            )}
            <p className="hint">{tr("A permanent code used by the app. Lower-case letters, numbers and _. It cannot be changed later.")}</p>
          </div>
          <div className="field">
            <label htmlFor="f-name">{tr("Name")}</label>
            <input id="f-name" name="name" required maxLength={80} defaultValue={f?.name ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="f-desc">{tr("Description")}</label>
            <textarea id="f-desc" name="description" rows={3} maxLength={600} defaultValue={f?.description ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="f-aud">{tr("Who uses it")}</label>
            <input id="f-aud" name="audience" maxLength={160} defaultValue={f?.audience ?? ""} placeholder={tr("e.g. Owner, sales staff")} />
          </div>
          <div className="field">
            <label htmlFor="f-ben">{tr("Benefit")}</label>
            <textarea id="f-ben" name="benefits" rows={2} maxLength={400} defaultValue={f?.benefits ?? ""} />
          </div>
        </section>

        <section className="card">
          <h2>{tr("Availability")}</h2>
          <div className="adm-grid2">
            <div className="field">
              <label htmlFor="f-mod">{tr("Category")}</label>
              <select id="f-mod" name="module" defaultValue={f?.module ?? ""} required>
                <option value="" disabled>
                  {tr("Choose a category")}
                </option>
                {modules.map((m) => (
                  <option key={m} value={m}>
                    {tr(m)}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-lvl">{tr("Default level")}</label>
              <select id="f-lvl" name="default_level" defaultValue={f?.default_level ?? "small"}>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {tr(LEVEL_LABEL[l])}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-status">{tr("Status")}</label>
              <select id="f-status" name="status" defaultValue={f?.status ?? "planned"}>
                <option value="live">{tr("Live")}</option>
                <option value="planned">{tr("Planned")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="f-sort">{tr("Sort order")}</label>
              <input id="f-sort" name="sort" type="number" min={0} step={1} defaultValue={f?.sort ?? 100} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="f-route">{tr("Screen address")}</label>
            <input id="f-route" name="route" maxLength={120} defaultValue={f?.route ?? ""} placeholder="/stock" />
            <p className="hint">{tr("Where the feature lives in the app, e.g. /stock. Leave empty if it has no screen of its own.")}</p>
          </div>
          <label className="check">
            <input type="checkbox" name="active" defaultChecked={f ? f.active : true} /> {tr("Active (shown to companies)")}
          </label>
        </section>

        <section className="card">
          <h2>{tr("Tutorial")}</h2>
          <p className="muted small">{tr("2–4 short steps in simple English. Shown when a company switches the feature on or opens its guide.")}</p>
          <TutorialEditor initial={tutorial} />
        </section>

        <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Saving…")}>
          {isNew ? tr("Add feature") : tr("Save feature")}
        </SubmitButton>
      </form>
    </>
  );
}
