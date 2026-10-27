"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useTr } from "@/lib/tr-client";
import { sendEnquiry, type EnquiryState } from "./actions";

export type ViewProduct = {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  brand: string | null;
  manufacturer: string | null;
  part_no: string | null;
  specification: string | null;
  unit: string | null;
  pack_size: string | null;
  hazardous: boolean | null;
  un_number: string | null;
  country_of_origin: string | null;
  summary: string | null;
  photo: string | null;
  price: number | null;
  documents: { id: string; title: string; kind: string }[];
};

const KIND: Record<string, string> = { datasheet: "Data sheet", sds: "Safety data sheet", coa: "Certificate of analysis", certificate: "Certificate" };

function money(n: number, ccy: string) {
  return `${ccy} ${n.toLocaleString("en-GB", { minimumFractionDigits: ccy === "TZS" ? 0 : 2, maximumFractionDigits: ccy === "TZS" ? 0 : 2 })}`;
}

export function CatalogueView({ slug, products, currency }: { slug: string; products: ViewProduct[]; currency: string }) {
  const tr = useTr();
  const [cat, setCat] = useState<string>("");
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [started, setStarted] = useState("");
  const [state, action, pending] = useActionState<EnquiryState, FormData>(sendEnquiry, { status: "idle", message: "" });

  useEffect(() => setStarted(String(Date.now())), []);
  useEffect(() => {
    if (state.status === "sent") setPicked({});
  }, [state]);

  const cats = useMemo(() => Array.from(new Set(products.map((p) => p.category || tr("Other products")))), [products, tr]);
  const shown = products.filter((p) => {
    if (cat && (p.category || tr("Other products")) !== cat) return false;
    if (!q) return true;
    const t = `${p.name} ${p.sku ?? ""} ${p.brand ?? ""} ${p.part_no ?? ""} ${p.specification ?? ""}`.toLowerCase();
    return q
      .toLowerCase()
      .split(/\s+/)
      .every((w) => t.includes(w));
  });
  const chosen = products.filter((p) => p.id in picked);
  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = { ...cur };
      if (id in next) delete next[id];
      else if (Object.keys(next).length < 30) next[id] = "1";
      return next;
    });

  let lastCat: string | null = null;
  return (
    <>
      <div className="cat-tools">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr("Search products")} aria-label={tr("Search products")} />
        {cats.length > 1 && (
          <div className="cat-chips" role="tablist">
            <button type="button" className={cat === "" ? "on" : undefined} onClick={() => setCat("")}>
              {tr("All")}
            </button>
            {cats.map((c) => (
              <button type="button" key={c} className={cat === c ? "on" : undefined} onClick={() => setCat(c)}>
                {c}
              </button>
            ))}
          </div>
        )}
      </div>

      {shown.length === 0 && <p className="cat-muted">{tr("No products match.")}</p>}
      <div className="cat-list">
        {shown.map((p) => {
          const c = p.category || tr("Other products");
          const head = c !== lastCat ? c : null;
          lastCat = c;
          const on = p.id in picked;
          return (
            <div key={p.id} className="cat-item-wrap">
              {head && !cat && <h2 className="cat-group">{head}</h2>}
              <article className={`cat-item${on ? " on" : ""}`} id={`p-${p.id}`}>
                {p.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.photo} alt={p.name} loading="lazy" />
                ) : (
                  <div className="cat-noimg" aria-hidden>
                    {p.name.slice(0, 1)}
                  </div>
                )}
                <div className="cat-body">
                  <h3>{p.name}</h3>
                  <p className="cat-meta">{[p.brand, p.sku && `${tr("Code")} ${p.sku}`, p.part_no && `${tr("Part no.")} ${p.part_no}`, p.pack_size].filter(Boolean).join(" · ")}</p>
                  {p.summary && <p>{p.summary}</p>}
                  {p.specification && <p className="cat-spec">{p.specification}</p>}
                  {(p.country_of_origin || p.hazardous) && (
                    <p className="cat-meta">
                      {p.country_of_origin && `${tr("Origin")}: ${p.country_of_origin}`}
                      {p.country_of_origin && p.hazardous && " · "}
                      {p.hazardous && `${tr("Hazardous")}${p.un_number ? ` (UN ${p.un_number})` : ""}`}
                    </p>
                  )}
                  {p.documents.length > 0 && (
                    <p className="cat-docs">
                      {p.documents.map((d) => (
                        <a key={d.id} href={`/c/${slug}/sheet/${d.id}`} target="_blank" rel="noopener">
                          {tr(KIND[d.kind] ?? "Document")}: {d.title}
                        </a>
                      ))}
                    </p>
                  )}
                  <div className="cat-row">
                    {p.price !== null && (
                      <span className="cat-price">
                        {money(Number(p.price), currency)} <small>/ {p.unit ?? tr("unit")}</small>
                      </span>
                    )}
                    <button type="button" className={`cat-btn${on ? " on" : ""}`} onClick={() => toggle(p.id)} aria-pressed={on}>
                      {on ? tr("✓ In your request") : tr("Ask for a quote")}
                    </button>
                  </div>
                </div>
              </article>
            </div>
          );
        })}
      </div>

      {chosen.length > 0 && state.status !== "sent" && (
        <a href="#request" className="cat-float">
          {tr("Request for quotation")} ({chosen.length})
        </a>
      )}

      <section className="cat-card" id="request">
        <h2>{chosen.length ? tr("Request for quotation") : tr("Send us a message")}</h2>
        {state.status === "sent" ? (
          <p className="cat-ok" role="status">
            {tr(state.message)}
          </p>
        ) : (
          <form action={action} className="cat-form">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="kind" value={chosen.length ? "quote" : "enquiry"} />
            <input type="hidden" name="started" value={started} />
            <div className="cat-hp" aria-hidden="true">
              <label>
                Website
                <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
              </label>
            </div>
            {chosen.length > 0 && (
              <ul className="cat-picked">
                {chosen.map((p) => (
                  <li key={p.id}>
                    <input type="hidden" name="product_id" value={p.id} />
                    <span>{p.name}</span>
                    <input
                      name={`qty_${p.id}`}
                      type="text"
                      inputMode="decimal"
                      value={picked[p.id]}
                      onChange={(e) => setPicked((cur) => ({ ...cur, [p.id]: e.target.value }))}
                      aria-label={`${tr("Quantity")}: ${p.name}`}
                    />
                    <small>{p.unit ?? ""}</small>
                    <button type="button" onClick={() => toggle(p.id)} aria-label={tr("Remove")}>
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {chosen.length === 0 && <p className="cat-muted">{tr("Tap “Ask for a quote” on the products you need, or just write your question.")}</p>}
            <label>
              {tr("Your name")}
              <input name="name" type="text" required minLength={2} maxLength={120} autoComplete="name" />
            </label>
            <label>
              {tr("Company")}
              <input name="company" type="text" maxLength={160} autoComplete="organization" />
            </label>
            <label>
              {tr("Email")}
              <input name="email" type="email" maxLength={200} autoComplete="email" />
            </label>
            <label>
              {tr("Phone or WhatsApp")}
              <input name="phone" type="tel" maxLength={20} autoComplete="tel" placeholder="+255" />
            </label>
            <label className="cat-wide">
              {tr("Message")}
              <textarea name="message" rows={4} maxLength={2000} placeholder={tr("Delivery place, date needed, grade or size…")} />
            </label>
            {state.status === "error" && (
              <p className="cat-err" role="alert">
                {tr(state.message)}
              </p>
            )}
            <button type="submit" className="cat-submit" disabled={pending || !started}>
              {pending ? tr("Sending…") : chosen.length ? tr("Send request for quotation") : tr("Send message")}
            </button>
            <p className="cat-muted cat-wide">{tr("We use your details only to answer this request.")}</p>
          </form>
        )}
      </section>
    </>
  );
}
