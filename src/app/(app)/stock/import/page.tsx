import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { can } from "@/lib/roles";
import { StockImport } from "./StockImport";

export const metadata = { title: "Load opening stock" };

export default async function OpeningStockPage() {
  await primeLang();
  const { role } = await getAppContext();
  if (!can(role, "adjustStock")) redirect("/stock");
  return (
    <>
      <p className="small">
        <Link href="/stock">{tr("← Stock")}</Link>
      </p>
      <h1>{tr("Load opening stock")}</h1>
      <p className="muted small">{tr("Use this once at go-live to record what is physically in your stores. Count first, then fill in the template: one row per product, store and batch. If any row has a problem, nothing is loaded and you are told which rows to fix. Each row is recorded as an “Opening stock” adjustment.")}</p>
      <p>
        <a className="btn" href="/templates/opening-stock-template.xlsx" download>{tr("Download the template")}</a>
      </p>
      <StockImport />
    </>
  );
}
