import Link from "next/link";
import { primeLang, tr } from "@/lib/tr";

export const metadata = { title: "Page not found" };

/**
 * Any address the app does not have, and notFound() on public pages (catalogue, playbooks, pay
 * links). Inside the company app, src/app/(app)/not-found.tsx shows a version within the app.
 */
export default async function NotFound() {
  await primeLang();
  return (
    <div className="auth-wrap">
      <img className="auth-logo" src="/brand/lemosp-on-dark.svg" alt={tr("LeMoSp")} />
      <div className="auth-card">
        <h1>{tr("Page not found")}</h1>
        <p className="muted">{tr("This address doesn't lead anywhere. The link may be old or mistyped, or the page has been removed.")}</p>
        <div className="actions">
          <Link className="btn btn-primary" href="/">
            {tr("Go to the start")}
          </Link>
          <Link className="btn" href="/how-it-works">
            {tr("How it works")}
          </Link>
        </div>
      </div>
      <p className="auth-foot">{tr("LeMoSp · a LeMo Tech Solutions product")}</p>
    </div>
  );
}
