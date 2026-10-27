import { primeLang, tr } from "@/lib/tr";
import { redirect } from "next/navigation";
import { getAppContext } from "@/lib/context";
import { can } from "@/lib/roles";
import { StockImport } from "./StockImport";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Load opening stock" };

export default async function OpeningStockPage() {
  await primeLang();
  const { role } = await getAppContext();
  if (!can(role, "adjustStock")) redirect("/stock");
  return (
    <>
      <BackLink href="/stock" label="Stock" />
      <h1>{tr("Load opening stock")}</h1>
      <p className="muted small">{tr("Use this once at go-live to record what is physically in your stores. Count first, then fill in the template: one row per product, store and batch. If any row has a problem, nothing is loaded and you are told which rows to fix. Each row is recorded as an “Opening stock” adjustment.")}</p>
      <p>
        <a className="btn" href="/templates/opening-stock-template.xlsx" download>{tr("Download the template")}</a>
      </p>
      <StockImport />
    </>
  );
}
