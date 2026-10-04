import { primeLang, tr } from "@/lib/tr";
import { requireManager } from "@/lib/context";
import { ImportClient } from "./ImportClient";

export const metadata = { title: "Import" };

export default async function ImportPage() {
  await primeLang();
  await requireManager();
  return (
    <>
      <h1>{tr("Import from spreadsheet")}</h1>
      <p className="muted">{tr("Load clients, suppliers and products from the master data template in one go. You can import again later: records with the same ID or SKU are updated, not duplicated.")}</p>
      <p className="small">
        <a href="/templates/master-data-template.xlsx" download>{tr("Download the blank template")}</a>
      </p>
      <ImportClient />
    </>
  );
}
