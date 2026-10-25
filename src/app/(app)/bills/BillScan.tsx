"use client";

import { useRef, useState } from "react";
import { AiReadNote, ScanReceipt } from "@/components/ai/ScanReceipt";
import { matchSupplier, receiptNote, type ReceiptCheck, type ReceiptField } from "@/lib/ai/receipt";
import { CURRENCIES } from "@/lib/lists";
import { useTr } from "@/lib/tr-client";

/** Which bill field shows each part of a reading (for the "check" marks). */
const FIELD_OF: Partial<Record<ReceiptField, string>> = {
  vendor: "supplier_id",
  receipt_no: "supplier_invoice_no",
  date: "bill_date",
  currency: "currency",
  subtotal: "subtotal",
  vat: "vat_amount",
};

/**
 * "Scan the supplier's invoice" on the new-bill form: fills in the fields of the form it sits in
 * (they are plain form fields, so the values are simply put in). Nothing is saved until the person
 * presses Save bill. The invoice picture itself is not kept here: add it under Documents if needed.
 */
export function BillScan({
  enabled,
  isManager,
  suppliers,
  supplierFixed,
}: {
  enabled: boolean;
  isManager: boolean;
  suppliers: { id: string; name: string; tax_no: string | null }[];
  /** The bill comes from a purchase order: the supplier is already set. */
  supplierFixed: boolean;
}) {
  const tr = useTr();
  const box = useRef<HTMLDivElement>(null);
  const [check, setCheck] = useState<ReceiptCheck | null>(null);
  const [noSupplier, setNoSupplier] = useState<string | null>(null);

  function onRead(c: ReceiptCheck) {
    const form = box.current?.closest("form");
    if (!form) return;
    const el = (name: string) => form.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[name="${name}"]`);
    const put = (name: string, value: string | number | null | undefined) => {
      const e = el(name);
      if (e && value !== null && value !== undefined && value !== "" && !(e instanceof HTMLInputElement && e.type === "hidden")) e.value = String(value);
    };
    const r = c.reading;
    const unsure = new Set(c.unsure.map((f) => FIELD_OF[f]).filter(Boolean) as string[]);
    put("supplier_invoice_no", r.receipt_no);
    put("bill_date", r.date);
    if (r.currency && CURRENCIES.includes(r.currency)) put("currency", r.currency);
    const subtotal = r.subtotal ?? (r.total !== null && r.vat !== null ? Math.round((r.total - r.vat) * 100) / 100 : null);
    if (subtotal === null) unsure.add("subtotal");
    put("subtotal", subtotal);
    put("vat_amount", r.vat ?? 0);
    const note = receiptNote(r);
    const notes = el("notes");
    if (notes && note && !notes.value.includes(note)) notes.value = [notes.value, note].filter(Boolean).join("\n").slice(0, 1000);
    setNoSupplier(null);
    if (!supplierFixed) {
      const id = matchSupplier(r, suppliers);
      if (id) put("supplier_id", id);
      else {
        unsure.add("supplier_id");
        setNoSupplier(r.vendor);
      }
    }
    // Mark what to check; the marks go when the field is changed.
    for (const name of ["supplier_id", "supplier_invoice_no", "bill_date", "currency", "subtotal", "vat_amount"]) {
      const e = el(name);
      if (!e) continue;
      e.style.outline = unsure.has(name) ? "2px solid var(--warn)" : "";
      e.style.outlineOffset = unsure.has(name) ? "1px" : "";
      if (unsure.has(name)) e.addEventListener("change", () => (e.style.outline = ""), { once: true });
    }
    setCheck(c);
  }

  return (
    <div ref={box}>
      <ScanReceipt enabled={enabled} purpose="bill" onRead={onRead} isManager={isManager} />
      {check && <AiReadNote check={check} />}
      {noSupplier !== null && (
        <p className="small text-warn">
          {noSupplier ? `${tr("Supplier on the invoice:")} ${noSupplier}. ` : ""}
          {tr("No matching supplier was found: choose the supplier, or add them first.")}
        </p>
      )}
    </div>
  );
}
