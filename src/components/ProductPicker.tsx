import { tr } from "@/lib/tr";
import type { ProductOption } from "@/lib/options";
import { UNITS } from "@/lib/lists";

/** Product drop-down plus free-text description, quantity and unit. */
export function ProductLineFields({ products, showPrice = false }: { products: ProductOption[]; showPrice?: boolean }) {
  return (
    <div className="grid grid-2">
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="product_id">{tr("Product")}{" "}<span className="hint">{tr("· or leave empty and describe it below")}</span>
        </label>
        <select id="product_id" name="product_id" defaultValue="">
          <option value="">{tr("— Not in the catalogue —")}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.sku})
            </option>
          ))}
        </select>
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor="description">{tr("Description")}{" "}<span className="hint">{tr("· filled from the product if left empty")}</span>
        </label>
        <input id="description" name="description" type="text" />
      </div>
      <div className="field">
        <label htmlFor="quantity">{tr("Quantity")}</label>
        <input id="quantity" name="quantity" type="text" inputMode="decimal" defaultValue="1" required />
      </div>
      <div className="field">
        <label htmlFor="unit">{tr("Unit")}</label>
        <select id="unit" name="unit" defaultValue="">
          <option value="">{tr("From product")}</option>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </div>
      {showPrice && (
        <>
          <div className="field">
            <label htmlFor="unit_price">{tr("Unit price")}{" "}<span className="hint">{tr("· empty = catalogue price")}</span>
            </label>
            <input id="unit_price" name="unit_price" type="text" inputMode="decimal" />
          </div>
          <div className="field">
            <label htmlFor="discount_pct">{tr("Discount %")}</label>
            <input id="discount_pct" name="discount_pct" type="text" inputMode="decimal" defaultValue="0" />
          </div>
        </>
      )}
    </div>
  );
}
