import Link from "next/link";
import { primeLang, tr } from "@/lib/tr";

export const metadata = { title: "Not found" };

/** notFound() inside the client and supplier portal: shown within the portal, with a way back. */
export default async function PortalNotFound() {
  await primeLang();
  return (
    <div className="card">
      <h1>{tr("We couldn't find that")}</h1>
      <p className="muted">{tr("The document may have been withdrawn, or the link is old.")}</p>
      <div className="actions">
        <Link className="btn btn-primary" href="/portal/home">
          {tr("Back to the portal")}
        </Link>
      </div>
    </div>
  );
}
