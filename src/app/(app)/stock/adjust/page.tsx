import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { productOptions } from "@/lib/options";
import { can } from "@/lib/roles";
import { storeOptions } from "@/lib/stock";
import { adjustStock } from "../actions";

export const metadata = { title: "Adjust stock" };

export default async function AdjustStockPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = (await searchParams) ?? {};
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  if (!can(role, "adjustStock")) redirect("/stock");
  const [products, stores] = await Promise.all([productOptions(supabase, company.id), storeOptions(supabase, company.id)]);

  return (
    <>
      <p className="small">
        <Link href="/stock">← Stock</Link>
      </p>
      <h1>Adjust stock</h1>
      <p className="muted small">
        Use this for opening balances when you start, after a stock count, or to write off damaged or expired goods. Every
        adjustment is recorded with your name and reason.
      </p>
      <Notice {...notice} />
      <form action={adjustStock} className="card">
        <div className="field">
          <label htmlFor="product_id">Product</label>
          <select id="product_id" name="product_id" required defaultValue={typeof sp.product === "string" ? sp.product : ""}>
            <option value="" disabled>
              Choose a product
            </option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="warehouse_id">Store</label>
            <select id="warehouse_id" name="warehouse_id" required>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="direction">Add or remove</label>
            <select id="direction" name="direction" defaultValue="add">
              <option value="add">Add to stock (+)</option>
              <option value="remove">Remove from stock (−)</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="quantity">Quantity</label>
            <input id="quantity" name="quantity" type="text" inputMode="decimal" required />
          </div>
          <div className="field">
            <label htmlFor="batch_no">
              Batch no. <span className="hint">· if the product has batches</span>
            </label>
            <input id="batch_no" name="batch_no" type="text" />
          </div>
          <div className="field">
            <label htmlFor="expiry_date">Expiry date</label>
            <input id="expiry_date" name="expiry_date" type="date" />
          </div>
          <div className="field">
            <label htmlFor="reason">Reason</label>
            <input id="reason" name="reason" type="text" required placeholder="e.g. Opening balance / count 30 Sep / damaged" />
          </div>
        </div>
        <SubmitButton className="btn btn-primary btn-block">Save adjustment</SubmitButton>
      </form>
    </>
  );
}
