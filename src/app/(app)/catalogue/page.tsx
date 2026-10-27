import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { catalogueUrl, emailShare, whatsappShare } from "@/lib/growth-tools/catalogue";
import { qrSvg } from "@/lib/growth-tools/qr";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { saveCatalogueSettings } from "./actions";
import { BackLink } from "@/components/BackLink";
import "../../growth-tools.css";

export const metadata = { title: "Online catalogue" };

function suggestSlug(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "catalogue"
  );
}

export default async function CataloguePage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, features, isManager } = await getAppContext();
  if (!features.on("online_catalogue")) return <FeatureOff title="Online catalogue" isManager={isManager} />;
  const [{ data: s, error }, { count: shown }, { count: newEnquiries }] = await Promise.all([
    supabase.from("catalogue_settings").select("*").eq("company_id", company.id).maybeSingle(),
    supabase.from("catalogue_products").select("product_id", { count: "exact", head: true }).eq("company_id", company.id).eq("public", true),
    can(roles, "seeCrm")
      ? supabase.from("catalogue_enquiries").select("id", { count: "exact", head: true }).eq("company_id", company.id).eq("status", "new")
      : Promise.resolve({ count: 0 }),
  ]);
  if (isMissingTable(error)) return <NotReady title="Online catalogue" />;
  const url = s ? catalogueUrl(s.slug) : null;
  // Needs the app's full address (NEXT_PUBLIC_MAIN_URL or NEXT_PUBLIC_SITE_URL); the QR download link works either way.
  const svg = url && s?.published && url.startsWith("http") ? qrSvg(url, { scale: 6 }) : null;
  const shareText = url ? `${tr("Our product catalogue")} - ${company.name}: ${url}` : "";

  return (
    <>
      <BackLink href="/products" label="Products" />
      <div className="page-head">
        <h1>{tr("Online catalogue")}</h1>
        {s?.published ? <span className="badge tone-ok">{tr("Public")}</span> : <span className="badge tone-off">{tr("Not public")}</span>}
      </div>
      <p className="muted small">{tr("A public page and PDF of the products you choose. Prices only where you switch them on; stock and costs are never shown.")}</p>
      <Notice {...notice} />
      <div className="stat-grid">
        <Link href="/catalogue/products" className="stat">
          <div className="n">{shown ?? 0}</div>
          <div className="l">{tr("Products shown")}</div>
        </Link>
        {can(roles, "seeCrm") && (
          <Link href="/catalogue/enquiries" className="stat">
            <div className={`n${newEnquiries ? " text-warn" : ""}`}>{newEnquiries ?? 0}</div>
            <div className="l">{tr("New requests")}</div>
          </Link>
        )}
      </div>

      {s && url && (
        <section className="card">
          <h2>{tr("Share")}</h2>
          {s.published ? (
            <>
              <p style={{ wordBreak: "break-all" }}>
                <a href={`/c/${s.slug}`} target="_blank" rel="noopener">
                  {url}
                </a>
              </p>
              <div className="gt-share">
                <a className="btn btn-small btn-primary" href={whatsappShare(shareText)} target="_blank" rel="noopener noreferrer">
                  {tr("Share on WhatsApp")}
                </a>
                <a className="btn btn-small" href={emailShare(`${company.name} - ${tr("product catalogue")}`, shareText)}>
                  {tr("Send by email")}
                </a>
                <a className="btn btn-small" href={`/c/${s.slug}/pdf`} target="_blank" rel="noopener">
                  {tr("Catalogue PDF")}
                </a>
                <a className="btn btn-small" href={`/c/${s.slug}/qr`} download={`${s.slug}-qr.svg`}>
                  {tr("Download QR code")}
                </a>
              </div>
              {svg && (
                <p style={{ marginTop: 12 }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img className="gt-qr" alt={tr("QR code of the catalogue page")} src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
                  <br />
                  <span className="small muted">{tr("Print it on your letterhead, delivery notes, stand or vehicle.")}</span>
                </p>
              )}
            </>
          ) : (
            <p className="small muted">{tr("Publish the catalogue below to get the link, the PDF and the QR code.")}</p>
          )}
        </section>
      )}

      {isManager ? (
        <form action={saveCatalogueSettings} className="card grid grid-2">
          <h2 style={{ margin: 0, gridColumn: "1 / -1" }}>{tr("Settings")}</h2>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="slug">{tr("Address")}</label>
            <input id="slug" name="slug" type="text" required pattern="[a-z0-9](?:[a-z0-9\-]{1,38}[a-z0-9])" maxLength={40} defaultValue={s?.slug ?? suggestSlug(company.name)} />
            <span className="hint">
              {catalogueUrl("")}
              <strong>{s?.slug ?? suggestSlug(company.name)}</strong> · {tr("small letters, numbers and dashes")}
            </span>
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="headline">{tr("Headline")}</label>
            <input id="headline" name="headline" type="text" maxLength={160} defaultValue={s?.headline ?? ""} placeholder={tr("e.g. Lubricants, chemicals and spares for mining and industry")} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="intro">{tr("Introduction")}</label>
            <textarea id="intro" name="intro" rows={4} maxLength={1500} defaultValue={s?.intro ?? ""} />
          </div>
          <div className="field" style={{ gridColumn: "1 / -1" }}>
            <label htmlFor="seo_description">
              {tr("Search engine description")} <span className="hint">{tr("shown by Google and in WhatsApp previews")}</span>
            </label>
            <textarea id="seo_description" name="seo_description" rows={2} maxLength={300} defaultValue={s?.seo_description ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="whatsapp">{tr("WhatsApp number")}</label>
            <input id="whatsapp" name="whatsapp" type="tel" maxLength={20} defaultValue={s?.whatsapp ?? ""} placeholder="255712345678" />
          </div>
          <div className="field">
            <span className="label">{tr("Show on the page")}</span>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="show_phone" defaultChecked={s?.show_phone ?? true} /> {tr("Phone")}
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="show_email" defaultChecked={s?.show_email ?? true} /> {tr("Email")}
            </label>
            <label className="row" style={{ gap: 6 }}>
              <input type="checkbox" name="show_address" defaultChecked={s?.show_address ?? true} /> {tr("Address")}
            </label>
          </div>
          <label className="row" style={{ gap: 8, gridColumn: "1 / -1" }}>
            <input type="checkbox" name="published" defaultChecked={s?.published ?? false} /> <strong>{tr("Public: anyone with the link can see the catalogue")}</strong>
          </label>
          <SubmitButton className="btn btn-primary" pendingText="…">
            {tr("Save")}
          </SubmitButton>
        </form>
      ) : (
        <p className="card small muted">{tr("Management chooses what the catalogue shows.")}</p>
      )}
    </>
  );
}
