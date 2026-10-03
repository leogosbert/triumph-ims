import Link from "next/link";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";
import { requireManager } from "@/lib/context";
import { readNotice, type SearchParams } from "@/lib/messages";
import { saveWarehouse } from "../stock/actions";

export const metadata = { title: "Stores" };

type W = { id: string; code: string; name: string; address: string | null; active: boolean };

function Fields({ w }: { w?: W }) {
  return (
    <div className="grid grid-2">
      <div className="field">
        <label>Code</label>
        <input name="code" type="text" defaultValue={w?.code ?? ""} placeholder="e.g. GTA" required maxLength={20} />
      </div>
      <div className="field">
        <label>Name</label>
        <input name="name" type="text" defaultValue={w?.name ?? ""} placeholder="e.g. Geita store" required />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label>Address</label>
        <input name="address" type="text" defaultValue={w?.address ?? ""} />
      </div>
      {w && (
        <div className="field">
          <label>Status</label>
          <select name="active" defaultValue={String(w.active)}>
            <option value="true">In use</option>
            <option value="false">Closed</option>
          </select>
        </div>
      )}
    </div>
  );
}

export default async function WarehousesPage({ searchParams }: { searchParams: SearchParams }) {
  const notice = await readNotice(searchParams);
  const { supabase, company } = await requireManager();
  const { data } = await supabase.from("warehouses").select("id, code, name, address, active").eq("company_id", company.id).order("code");
  const stores = (data ?? []) as W[];

  return (
    <>
      <p className="small">
        <Link href="/stock">← Stock</Link>
      </p>
      <h1>Stores and warehouses</h1>
      <Notice {...notice} />
      {stores.map((w) => (
        <details key={w.id} className="card">
          <summary>
            <strong>{w.name}</strong> <span className="badge">{w.code}</span> {!w.active && <span className="badge off">Closed</span>}
          </summary>
          <form action={saveWarehouse} style={{ marginTop: 12 }}>
            <input type="hidden" name="id" value={w.id} />
            <Fields w={w} />
            <SubmitButton>Save</SubmitButton>
          </form>
        </details>
      ))}
      <section className="card">
        <h2>Add a store</h2>
        <form action={saveWarehouse}>
          <input type="hidden" name="id" value="" />
          <Fields />
          <SubmitButton pendingText="Adding…">Add store</SubmitButton>
        </form>
      </section>
    </>
  );
}
