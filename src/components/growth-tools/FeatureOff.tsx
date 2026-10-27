import Link from "next/link";
import { tr } from "@/lib/tr";

/** Shown on a growth-tool screen while its feature is switched off for the company. */
export function FeatureOff({ title, isManager }: { title: string; isManager: boolean }) {
  return (
    <>
      <h1>{tr(title)}</h1>
      <div className="card">
        <p>{tr("This feature is switched off for your company.")}</p>
        {isManager ? (
          <Link href="/settings/features" className="btn btn-primary btn-small">
            {tr("Switch it on in Features")}
          </Link>
        ) : (
          <p className="small muted">{tr("Ask management to switch it on in Settings, then Features.")}</p>
        )}
      </div>
    </>
  );
}
