import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { PAID_FROM } from "@/lib/ledger";
import { readNotice, type SearchParams } from "@/lib/messages";
import { todayTz } from "@/lib/services";
import { addAsset } from "../../actions";
import { BackLink, ledgerContext } from "../../shared";
import { AssetFields } from "../AssetFields";
import { vehicleOptions } from "../vehicles";

export const metadata = { title: "New asset" };

export default async function NewAssetPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company } = await ledgerContext();
  const vehicles = await vehicleOptions(supabase, company.id);

  return (
    <>
      <BackLink href="/accounts/assets" label="← Fixed assets" />
      <h1>{tr("New asset")}</h1>
      <Notice {...notice} />
      <form action={addAsset} className="card">
        <AssetFields vehicles={vehicles} />
        <h2>{tr("Cost and life")}</h2>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="bought_on">{tr("Bought on")}</label>
            <input id="bought_on" name="bought_on" type="date" required defaultValue={todayTz()} />
          </div>
          <div className="field">
            <label htmlFor="cost">
              {tr("Cost")} ({company.base_currency})
            </label>
            <input id="cost" name="cost" type="text" inputMode="decimal" required />
          </div>
          <div className="field">
            <label htmlFor="residual">{tr("Value at the end of its life")}</label>
            <input id="residual" name="residual" type="text" inputMode="decimal" defaultValue="0" />
          </div>
          <div className="field">
            <label htmlFor="life">{tr("Useful life")}</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input id="life" name="life" type="text" inputMode="numeric" required defaultValue="5" style={{ flex: 1, minWidth: 0 }} />
              <select name="life_unit" defaultValue="years" aria-label={tr("Years or months")}>
                <option value="years">{tr("years")}</option>
                <option value="months">{tr("months")}</option>
              </select>
            </div>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="paid_from">{tr("Paid from")}</label>
            <select id="paid_from" name="paid_from" defaultValue="bank">
              {PAID_FROM.map((p) => (
                <option key={p.key} value={p.key}>
                  {tr(p.label)}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="small muted">
          {tr("The cost is posted to the books straight away. Choose “Already entered as a supplier bill” when the bill for it is in LeMoSp, so it is not counted twice. Cost and life cannot be changed later.")}
        </p>
        <SubmitButton>{tr("Add asset")}</SubmitButton>
      </form>
    </>
  );
}
