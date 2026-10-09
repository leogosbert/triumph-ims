import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { readNotice, type SearchParams } from "@/lib/messages";
import { saveCategory } from "../../actions";
import { CATEGORIES_MISSING, categoryHref, groupByCategory, loadCategories } from "../../categories";
import { platformAdmin } from "../../guard";

export const metadata = { title: "Feature categories" };

type Feature = { key: string; module: string | null; status: string; active: boolean };

/** LeMoSp ADMIN: the categories that group the feature catalogue. */
export default async function AdminCategoriesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const admin = await platformAdmin();
  if (!admin.ok) return null;
  const notice = await readNotice(searchParams);
  const [categories, { data }] = await Promise.all([
    loadCategories(admin.supabase),
    admin.supabase.from("features").select("key, module, status, active"),
  ]);
  const groups = groupByCategory(categories.list, (data ?? []) as Feature[], { keepEmpty: true });
  const nextSort = Math.max(0, ...categories.list.filter((c) => c.sort < 900).map((c) => c.sort)) + 10;

  return (
    <>
      <p className="small">
        <Link href="/admin/features">{tr("← Features")}</Link>
      </p>
      <h2 className="adm-title">{tr("Feature categories")}</h2>
      <p className="muted small">
        {tr("Categories group the features the app can provide, in the admin catalogue and in each company's Features page. Open a category to rename it, change its order, or add and remove features.")}
      </p>
      <Notice {...notice} />
      {!categories.ready && <p className="notice notice-error">{tr(CATEGORIES_MISSING)}</p>}

      <ul className="rec-list">
        {groups.map(({ category, items }) => {
          const live = items.filter((f) => f.status === "live" && f.active).length;
          return (
            <li key={category.name}>
              <Link href={categories.ready ? categoryHref(category.name) : "/admin/features"}>
                <div className="main">
                  <div className="title">{tr(category.name)}</div>
                  <div className="sub">{category.description ? tr(category.description) : tr("No description")}</div>
                </div>
                <div className="side adm-side">
                  <span className="badge tone-info">
                    {items.length} {tr(items.length === 1 ? "feature" : "features")}
                  </span>
                  <span className="small muted">
                    {live} {tr("live")}
                  </span>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>

      {categories.ready && (
        <section className="card">
          <h2>{tr("Add a category")}</h2>
          <form action={saveCategory}>
            <div className="adm-grid2">
              <div className="field">
                <label htmlFor="c-name">{tr("Name")}</label>
                <input id="c-name" name="name" required minLength={2} maxLength={60} placeholder={tr("e.g. Manufacturing")} />
              </div>
              <div className="field">
                <label htmlFor="c-sort">{tr("Sort order")}</label>
                <input id="c-sort" name="sort" type="number" min={0} max={100000} step={1} defaultValue={nextSort} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="c-desc">{tr("Description")}</label>
              <input id="c-desc" name="description" maxLength={300} placeholder={tr("What kind of features belong here")} />
            </div>
            <SubmitButton className="btn btn-primary" pendingText={tr("Saving…")}>
              {tr("Add category")}
            </SubmitButton>
          </form>
        </section>
      )}
    </>
  );
}
