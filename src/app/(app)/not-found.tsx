import Link from "next/link";
import { BackLink } from "@/components/BackLink";
import { primeLang, tr } from "@/lib/tr";

export const metadata = { title: "Not found" };

/**
 * notFound() on any screen of the company app (a deleted record, another company's record, a bad
 * link): shown inside the app, with the menus still there and a way back.
 */
export default async function AppNotFound() {
  await primeLang();
  return (
    <>
      <BackLink href="/" label="Home" />
      <div className="card">
        <h1>{tr("We couldn't find that")}</h1>
        <p className="muted">{tr("The record or screen may have been removed, the link may be old, or it belongs to another company.")}</p>
        <div className="actions">
          <Link className="btn btn-primary" href="/">
            {tr("Go to Home")}
          </Link>
          <Link className="btn" href="/search">
            {tr("Search")}
          </Link>
        </div>
      </div>
    </>
  );
}
