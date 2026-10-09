import { tr } from "@/lib/tr";

/** Shown on a new screen until LeMo Tech has run the database update it needs. */
export function NotReady({ title }: { title: string }) {
  return (
    <>
      <h1>{tr(title)}</h1>
      <p className="card muted">{tr("This is not available yet. Ask LeMo Tech to run the latest database update.")}</p>
    </>
  );
}
