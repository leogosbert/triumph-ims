import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { LevelBadge } from "@/components/suggestions/SuggestionBadge";
import { readNotice, type SearchParams } from "@/lib/messages";
import { deleteCategory, saveCategory, setFeatureCategory } from "../../../actions";
import { CATEGORIES_MISSING, loadCategories } from "../../../categories";
import { platformAdmin } from "../../../guard";

export const metadata = { title: "Feature category" };

type Feature = { key: string; name: string; module: string | null; default_level: string; status: string; active: boolean };

/** LeMoSp ADMIN: one feature category — its details, the features in it, and removing it. */
export default async function AdminCategoryPage({ params, searchParams }: { params: Promise<{ name: string }>; searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const name = decodeURIComponent((await params).name);
  const notice = await readNotice(searchParams);
  const [categories, { data }] = await Promise.all([
    loadCategories(admin.supabase),
    admin.supabase.from("features").select("key, name, module, default_level, status, active").order("sort").order("name"),
  ]);
  const category = categories.list.find((c) => c.name === name);
  const back = (
    <p className="small">
      <Link href="/admin/features/categories">{tr("← Categories")}</Link>
    </p>
  );
  if (!categories.ready || !category) {
    return (
      <>
        {back}
        <Notice {...notice} />
        <p className={categories.ready ? "card muted" : "notice notice-error"}>
          {categories.ready ? tr("Category not found.") : tr(CATEGORIES_MISSING)}
        </p>
      </>
    );
  }

  const all = (data ?? []) as Feature[];
  const inside = all.filter((f) => (f.module || "Other") === name);
  const outside = all.filter((f) => (f.module || "Other") !== name);
  const others = categories.list.filter((c) => c.name !== name);

  return (
    <>
      {back}
      <div className="page-head">
        <h2 className="adm-title">{tr(category.name)}</h2>
        <span className="badge tone-info">
          {inside.length} {tr(inside.length === 1 ? "feature" : "features")}
        </span>
      </div>
      <Notice {...notice} />

      <section className="card">
        <h2>{tr("Features in this category")}</h2>
        {inside.length === 0 ? (
          <p className="muted small">{tr("No features in this category yet. Add one below.")}</p>
        ) : (
          <ul className="list">
            {inside.map((f) => (
              <li key={f.key}>
                <div className="row adm-feature-row">
                  <span className={!f.active ? "adm-inactive" : undefined}>
                    <Link href={`/admin/features/${encodeURIComponent(f.key)}`}>{f.name}</Link>{" "}
                    <LevelBadge level={f.default_level} />
                    {f.status !== "live" && <span className="badge tone-off">{tr("Planned")}</span>}
                  </span>
                  {others.length > 0 && (
                    <form action={setFeatureCategory} className="adm-inline-form adm-move">
                      <input type="hidden" name="key" value={f.key} />
                      <input type="hidden" name="back" value={name} />
                      <select name="category" aria-label={`${tr("Move")} ${f.name}`} defaultValue="" required>
                        <option value="" disabled>
                          {tr("Move to…")}
                        </option>
                        {others.map((c) => (
                          <option key={c.name} value={c.name}>
                            {tr(c.name)}
                          </option>
                        ))}
                      </select>
                      <SubmitButton className="btn btn-small" pendingText="…">
                        {tr("Move")}
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {outside.length > 0 && (
          <form action={setFeatureCategory} className="adm-inline-form adm-add-feature">
            <input type="hidden" name="category" value={name} />
            <input type="hidden" name="back" value={name} />
            <select name="key" aria-label={tr("Add a feature to this category")} defaultValue="" required>
              <option value="" disabled>
                {tr("Add a feature to this category…")}
              </option>
              {others.map((c) => {
                const fs = outside.filter((f) => (f.module || "Other") === c.name);
                return fs.length === 0 ? null : (
                  <optgroup key={c.name} label={tr(c.name)}>
                    {fs.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.name}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
            <SubmitButton className="btn btn-primary btn-small" pendingText={tr("Saving…")}>
              {tr("Add")}
            </SubmitButton>
          </form>
        )}
        <p className="hint">
          {tr("A feature belongs to one category: adding it here takes it out of its old one. To create a brand-new feature, use + New feature in the catalogue.")}
        </p>
      </section>

      <section className="card">
        <h2>{tr("Details")}</h2>
        <form action={saveCategory}>
          <input type="hidden" name="old_name" value={category.name} />
          <div className="adm-grid2">
            <div className="field">
              <label htmlFor="c-name">{tr("Name")}</label>
              <input id="c-name" name="name" required minLength={2} maxLength={60} defaultValue={category.name} />
            </div>
            <div className="field">
              <label htmlFor="c-sort">{tr("Sort order")}</label>
              <input id="c-sort" name="sort" type="number" min={0} max={100000} step={1} defaultValue={category.sort} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="c-desc">{tr("Description")}</label>
            <input id="c-desc" name="description" maxLength={300} defaultValue={category.description ?? ""} />
            <p className="hint">{tr("Renaming a category keeps all its features in it.")}</p>
          </div>
          <SubmitButton className="btn btn-primary" pendingText={tr("Saving…")}>
            {tr("Save category")}
          </SubmitButton>
        </form>
      </section>

      <section className="card adm-danger" id="remove">
        <h2>{tr("Remove this category")}</h2>
        {others.length === 0 ? (
          <p className="muted small">{tr("This is the only category, so it cannot be removed.")}</p>
        ) : (
          <form action={deleteCategory}>
            <input type="hidden" name="name" value={category.name} />
            {inside.length > 0 && (
              <div className="field">
                <label htmlFor="c-move">{tr("Move its features to")}</label>
                <select id="c-move" name="move_to" defaultValue="" required>
                  <option value="" disabled>
                    {tr("Choose a category")}
                  </option>
                  {others.map((c) => (
                    <option key={c.name} value={c.name}>
                      {tr(c.name)}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <label className="check">
              <input type="checkbox" name="confirm" /> {tr("Yes, remove this category")}
            </label>
            <p className="hint">{tr("No feature is deleted and no company loses anything: features only change group.")}</p>
            <SubmitButton className="btn" pendingText={tr("Removing…")}>
              {tr("Remove category")}
            </SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}
