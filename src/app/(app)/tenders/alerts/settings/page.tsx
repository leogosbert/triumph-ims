import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FeatureOff } from "@/components/growth-tools/FeatureOff";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { can } from "@/lib/roles";
import { StatusBadge } from "@/lib/sales";
import { addSource, removeSource, saveAlertSettings, toggleSource } from "../actions";
import { BackLink } from "@/components/BackLink";

export const metadata = { title: "Tender alert settings" };

const SOURCE_STATUS: Record<string, { label: string; tone: string }> = {
  ok: { label: "Read", tone: "ok" },
  empty: { label: "Nothing found", tone: "warn" },
  blocked: { label: "Not allowed", tone: "bad" },
  failed: { label: "Failed", tone: "warn" },
};

type Source = {
  id: string;
  name: string;
  url: string;
  kind: string;
  active: boolean;
  interval_hours: number;
  last_fetched_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_found: number | null;
};

export default async function AlertSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, roles, features, isManager } = await getAppContext();
  if (!can(roles, "seeCrm")) redirect("/");
  if (!features.on("tender_alerts")) return <FeatureOff title="Tender alerts" isManager={isManager} />;
  const [{ data: s, error }, { data: sources }, { data: cats }] = await Promise.all([
    supabase.from("tender_alert_settings").select("*").eq("company_id", company.id).maybeSingle(),
    supabase.from("tender_sources").select("id, name, url, kind, active, interval_hours, last_fetched_at, last_status, last_error, last_found").eq("company_id", company.id).order("created_at"),
    supabase.from("products").select("category").eq("company_id", company.id).eq("active", true).not("category", "is", null).limit(2000),
  ]);
  if (isMissingTable(error)) return <NotReady title="Tender alerts" />;
  const productCats = Array.from(new Set((cats ?? []).map((c) => String(c.category).trim()).filter(Boolean))).slice(0, 20);
  const join = (v: string[] | null | undefined) => (v ?? []).join(", ");

  return (
    <>
      <BackLink href="/tenders/alerts" label="Tender alerts" />
      <h1>{tr("Tender alert settings")}</h1>
      <Notice {...notice} />
      <form action={saveAlertSettings} className="card grid">
        <h2 style={{ margin: 0 }}>{tr("What you sell")}</h2>
        <div className="field">
          <label htmlFor="keywords">
            {tr("Keywords")} <span className="hint">{tr("separated by commas")}</span>
          </label>
          <textarea id="keywords" name="keywords" rows={3} defaultValue={join(s?.keywords)} placeholder={tr("e.g. lubricants, hydraulic oil, grease, filters, bearings, PPE, chemicals")} />
        </div>
        <div className="field">
          <label htmlFor="categories">
            {tr("Product groups")} <span className="hint">{tr("your product categories are used too")}</span>
          </label>
          <textarea id="categories" name="categories" rows={2} defaultValue={join(s?.categories)} />
          {productCats.length > 0 && (
            <span className="hint">
              {tr("From your products")}: {productCats.join(", ")}
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="exclude_keywords">
            {tr("Words you never bid for")} <span className="hint">{tr("a notice with these is marked No bid")}</span>
          </label>
          <textarea id="exclude_keywords" name="exclude_keywords" rows={2} defaultValue={join(s?.exclude_keywords)} placeholder={tr("e.g. construction works, consultancy, catering")} />
        </div>
        <div className="field">
          <label htmlFor="buyers">
            {tr("Buyers you want to work with")} <span className="hint">{tr("optional")}</span>
          </label>
          <textarea id="buyers" name="buyers" rows={2} defaultValue={join(s?.buyers)} placeholder={tr("e.g. Geita Gold Mining, TANESCO, Kilombero Sugar")} />
        </div>
        <div className="field">
          <label htmlFor="min_score">{tr("Lowest score in the daily digest")}</label>
          <input id="min_score" name="min_score" type="number" min={0} max={100} defaultValue={s?.min_score ?? 40} />
        </div>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" name="digest_on" defaultChecked={s?.digest_on ?? true} /> {tr("Send the daily digest to management and sales (from 7:00)")}
        </label>
        <label className="row" style={{ gap: 8 }}>
          <input type="checkbox" name="inbox_pick" defaultChecked={s?.inbox_pick ?? true} /> {tr("Pick up tender emails that arrive in the Inbox")}
        </label>
        <SubmitButton className="btn btn-primary" pendingText="…">
          {tr("Save")}
        </SubmitButton>
      </form>

      <section className="card">
        <h2>{tr("Emails")}</h2>
        <p className="small">
          {tr("If you receive tender alerts by email (for example from NeST, PPRA or a client's procurement team), forward them to your company Inbox address. Emails that look like tender notices are read and scored automatically.")}{" "}
          <Link href="/inbox">{tr("Open the Inbox")}</Link>
        </p>
      </section>

      <section className="card" id="sources">
        <h2>{tr("Public tender pages")}</h2>
        <p className="small muted">
          {tr("Add the web page or RSS feed where a buyer lists its tenders. The app reads each page at most once in the chosen hours, obeys the site's robots.txt and only reads public pages: no sign-in, no passwords.")}
        </p>
        {(sources ?? []).length === 0 ? (
          <p className="small muted">{tr("No pages yet.")}</p>
        ) : (
          <ul className="list">
            {((sources ?? []) as Source[]).map((src) => (
              <li key={src.id}>
                <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <strong>{src.name}</strong> {!src.active && <span className="badge tone-off">{tr("Paused")}</span>}
                    <div className="small muted" style={{ wordBreak: "break-all" }}>
                      {src.url}
                    </div>
                    <div className="small muted">
                      {src.kind === "rss" ? tr("RSS feed") : tr("Web page")} · {tr("every")} {src.interval_hours} {tr("hours")}
                      {src.last_fetched_at && ` · ${formatDateTime(src.last_fetched_at)}`}
                      {src.last_found !== null && src.last_status === "ok" && ` · ${src.last_found} ${tr("new")}`}
                    </div>
                    {src.last_error && <div className="small text-warn">{tr(src.last_error)}</div>}
                  </div>
                  {src.last_status && <StatusBadge map={SOURCE_STATUS} status={src.last_status} />}
                </div>
                {isManager && (
                  <div className="gt-share" style={{ marginTop: 6 }}>
                    <form action={toggleSource}>
                      <input type="hidden" name="id" value={src.id} />
                      <input type="hidden" name="active" value={src.active ? "0" : "1"} />
                      <button type="submit" className="btn btn-small">
                        {src.active ? tr("Pause") : tr("Resume")}
                      </button>
                    </form>
                    <form action={removeSource}>
                      <input type="hidden" name="id" value={src.id} />
                      <button type="submit" className="btn btn-small btn-danger">
                        {tr("Remove")}
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {isManager ? (
          <form action={addSource} className="grid grid-2" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="s_name">{tr("Name")}</label>
              <input id="s_name" name="name" type="text" maxLength={120} placeholder={tr("e.g. Mine procurement page")} />
            </div>
            <div className="field">
              <label htmlFor="s_url">{tr("Link")}</label>
              <input id="s_url" name="url" type="url" required maxLength={500} placeholder="https://" />
            </div>
            <div className="field">
              <label htmlFor="s_kind">{tr("Kind")}</label>
              <select id="s_kind" name="kind" defaultValue="page">
                <option value="page">{tr("Web page")}</option>
                <option value="rss">{tr("RSS feed")}</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="s_hours">{tr("Read every (hours)")}</label>
              <input id="s_hours" name="interval_hours" type="number" min={6} max={168} defaultValue={24} />
            </div>
            <SubmitButton className="btn btn-small" pendingText="…">
              {tr("Add page")}
            </SubmitButton>
          </form>
        ) : (
          <p className="small muted">{tr("Management adds and removes pages.")}</p>
        )}
      </section>
    </>
  );
}
