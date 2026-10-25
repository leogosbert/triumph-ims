import Link from "next/link";
import { primeLang, tr } from "@/lib/tr";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { companyPeople } from "@/lib/people";
import { todayTz } from "@/lib/services";
import { addDaysIso } from "@/lib/meetings/dates";
import { addEntry, removeEntry } from "./actions";
import { FeedLink } from "./FeedLink";
import styles from "../meetings/meetings.module.css";

export const metadata = { title: "Calendar" };

type Item = { uid: string; date: string; end?: string | null; time?: string | null; kind: string; title: string; notes?: string | null; href?: string | null; entry_id?: string };

/** Filters (what calendar_items reads) and the colour of each kind of date. */
const FILTERS: [string, string][] = [
  ["meeting", "Meetings"],
  ["action", "Actions"],
  ["entry", "Dates added"],
  ["delivery", "Deliveries"],
  ["supplies", "Supplies"],
  ["quotation", "Quotations"],
  ["invoice", "Invoices"],
  ["compliance", "Compliance"],
  ["leave", "Leave"],
  ["follow_up", "Follow-ups"],
];
const COLOUR: Record<string, string> = {
  meeting: "#4f7cff",
  action: "#e2584d",
  delivery: "#2fbf6f",
  supplies: "#f0a63a",
  quotation: "#9a7bd0",
  invoice: "#c8873a",
  compliance: "#d9468f",
  leave: "#4fb7d9",
  follow_up: "#7a8a99",
  event: "#14b8a6",
  payment: "#c8873a",
  task: "#e2584d",
  other: "#8a93a3",
};
const ENTRY_KINDS: Record<string, string> = {
  meeting: "Meeting",
  delivery: "Delivery",
  follow_up: "Follow-up",
  event: "Event",
  payment: "Payment",
  supplies: "Supplies arriving",
  task: "Task",
  other: "Other",
};
const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
/** Monday of the week of d. */
function monday(d: string): string {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDaysIso(d, -((day + 6) % 7));
}
function monthLabel(d: string) {
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
}
function dayLabel(d: string) {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
}

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const sp = (await searchParams) ?? {};
  const view = sp.view === "week" || sp.view === "agenda" ? sp.view : "month";
  const today = todayTz();
  const anchor = isDate(sp.d) ? sp.d : today;
  const picked = typeof sp.k === "string" && sp.k ? sp.k.split(",").filter((k) => FILTERS.some(([f]) => f === k)) : [];
  const { supabase, company, user } = await getAppContext();

  let from: string;
  let to: string;
  let prev: string;
  let next: string;
  if (view === "month") {
    const first = `${anchor.slice(0, 8)}01`;
    from = monday(first);
    const lastDay = addDaysIso(`${addDaysIso(first, 32).slice(0, 8)}01`, -1);
    to = addDaysIso(monday(lastDay), 6);
    prev = `${addDaysIso(first, -1).slice(0, 8)}01`;
    next = `${addDaysIso(first, 32).slice(0, 8)}01`;
  } else if (view === "week") {
    from = monday(anchor);
    to = addDaysIso(from, 6);
    prev = addDaysIso(from, -7);
    next = addDaysIso(from, 7);
  } else {
    from = anchor;
    to = addDaysIso(anchor, 60);
    prev = addDaysIso(anchor, -30);
    next = addDaysIso(anchor, 30);
  }

  const { data, error } = await supabase.rpc("calendar_items", { p_company: company.id, p_from: from, p_to: to, p_kinds: picked.length ? picked : null });
  if (isMissingTable(error)) return <NotReady title="Calendar" />;
  if (error) throw new Error(error.message);
  const items = ((data ?? []) as Item[]).sort((a, b) => a.date.localeCompare(b.date) || String(a.time ?? "99").localeCompare(String(b.time ?? "99")));
  const [people, link] = await Promise.all([
    companyPeople(supabase, company.id),
    supabase.from("calendar_links").select("id, kinds").eq("user_id", user.id).eq("company_id", company.id).is("revoked_at", null).maybeSingle(),
  ]);

  // Dates spanning several days show on each day.
  const byDay = new Map<string, Item[]>();
  for (const it of items) {
    const last = it.end && it.end > it.date ? (it.end < to ? it.end : to) : it.date;
    for (let d = it.date < from ? from : it.date; d <= last; d = addDaysIso(d, 1)) {
      byDay.set(d, [...(byDay.get(d) ?? []), it]);
    }
  }
  const q = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    const all = { view, d: anchor, k: picked.join(","), ...o };
    for (const [k, v] of Object.entries(all)) if (v) p.set(k, v);
    return `/calendar?${p.toString()}`;
  };
  const here = q({});
  const ev = (it: Item, small = true) => {
    const href = it.href && it.href.startsWith("/") ? it.href : "/calendar";
    return (
      <Link key={`${it.uid}-${small}`} href={href} className={small ? styles.ev : undefined} style={{ ["--k" as string]: COLOUR[it.kind] ?? COLOUR.other }} title={it.title}>
        {small ? (
          <>
            {it.time ? `${it.time.slice(0, 5)} ` : ""}
            {it.title}
          </>
        ) : (
          <>
            <span className={styles.kindDot} aria-hidden="true" />
            <strong>{it.title}</strong>
          </>
        )}
      </Link>
    );
  };

  const list = (days: string[]) =>
    days.map((d) => {
      const day = byDay.get(d) ?? [];
      if (!day.length && view === "agenda") return null;
      return (
        <div key={d}>
          <div className={styles.agendaDay} style={d === today ? { color: "var(--brand)" } : undefined}>
            {tr(dayLabel(d).split(" ")[0])} {dayLabel(d).split(" ").slice(1).join(" ")}
            {d === today && ` · ${tr("Today")}`}
          </div>
          {day.length === 0 ? (
            <p className="small muted" style={{ margin: "4px 0" }}>
              -
            </p>
          ) : (
            <ul className="rec-list">
              {day.map((it) => (
                <li key={it.uid} style={{ ["--k" as string]: COLOUR[it.kind] ?? COLOUR.other }}>
                  {ev(it, false)}
                  <div className={styles.meta}>
                    {it.time && <span className={styles.when}>{it.time}</span>}
                    <span>{tr(FILTERS.find(([k]) => k === it.kind)?.[1] ?? ENTRY_KINDS[it.kind] ?? it.kind)}</span>
                    {it.end && it.end > it.date && (
                      <span>
                        {tr("until")} {it.end}
                      </span>
                    )}
                    {it.notes && <span>{it.notes}</span>}
                  </div>
                  {it.entry_id && (
                    <form action={removeEntry} style={{ marginTop: 4 }}>
                      <input type="hidden" name="id" value={it.entry_id} />
                      <input type="hidden" name="back" value={here} />
                      <SubmitButton className="btn btn-small">{tr("Remove")}</SubmitButton>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      );
    });

  const days: string[] = [];
  for (let d = from; d <= to; d = addDaysIso(d, 1)) days.push(d);

  return (
    <>
      <div className="page-head">
        <h1>{tr("Calendar")}</h1>
        <Link href="/meetings/new" className="btn btn-small">
          {tr("+ Meeting")}
        </Link>
      </div>
      <p className="muted small">{tr("Meetings, actions, deliveries, supplies arriving, quotation and invoice dates, filings and licences, leave and follow-ups in one place.")}</p>
      <Notice {...notice} />

      <nav className="tabs-row" aria-label={tr("View")}>
        {(["month", "week", "agenda"] as const).map((v) => (
          <Link key={v} href={q({ view: v })} aria-current={view === v ? "page" : undefined}>
            {tr(v === "month" ? "Month" : v === "week" ? "Week" : "List")}
          </Link>
        ))}
      </nav>
      <div className="line-head" style={{ margin: "8px 0" }}>
        <Link href={q({ d: prev })} className="btn btn-small" aria-label={tr("Earlier")}>
          ←
        </Link>
        <strong>{view === "month" ? tr(monthLabel(anchor).split(" ")[0]) + " " + monthLabel(anchor).split(" ")[1] : `${from} – ${to}`}</strong>
        <span>
          <Link href={q({ d: today })} className="btn btn-small">
            {tr("Today")}
          </Link>{" "}
          <Link href={q({ d: next })} className="btn btn-small" aria-label={tr("Later")}>
            →
          </Link>
        </span>
      </div>
      <details>
        <summary className="small">{picked.length ? `${tr("Showing")}: ${picked.map((k) => tr(FILTERS.find(([f]) => f === k)?.[1] ?? k)).join(", ")}` : tr("Filter")}</summary>
        <div className={styles.chips} style={{ margin: "8px 0" }}>
          <Link href={q({ k: undefined })} className={styles.chip}>
            {tr("All")}
          </Link>
          {FILTERS.map(([k, l]) => {
            const on = picked.includes(k);
            const nextK = on ? picked.filter((x) => x !== k) : [...picked, k];
            return (
              <Link key={k} href={q({ k: nextK.join(",") || undefined })} className={styles.chip} aria-pressed={on} style={on ? { borderColor: COLOUR[k] } : undefined}>
                <span className={styles.kindDot} style={{ ["--k" as string]: COLOUR[k] }} aria-hidden="true" />
                {tr(l)}
              </Link>
            );
          })}
        </div>
      </details>

      <section className="card">
        {view === "month" ? (
          <div className={styles.monthGrid}>
            {DOW.map((d) => (
              <div key={d} className={styles.dow}>
                {tr(d)}
              </div>
            ))}
            {days.map((d) => {
              const day = byDay.get(d) ?? [];
              return (
                <div key={d} className={`${styles.day} ${d.slice(0, 7) !== anchor.slice(0, 7) ? styles.dayOut : ""} ${d === today ? styles.today : ""}`}>
                  <Link href={q({ view: "agenda", d })} className={styles.dayNum}>
                    {Number(d.slice(8))}
                  </Link>
                  {day.slice(0, 3).map((it) => ev(it))}
                  {day.length > 3 && (
                    <Link href={q({ view: "agenda", d })} className={styles.more}>
                      +{day.length - 3} {tr("more")}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.weekList}>{list(days)}</div>
        )}
        {view === "agenda" && items.length === 0 && <p className="muted">{tr("Nothing in the next two months.")}</p>}
      </section>

      <details className="card">
        <summary>{tr("+ Add a date")}</summary>
        <form action={addEntry}>
          <input type="hidden" name="back" value={here} />
          <label className="field">
            <span>{tr("Title")}</span>
            <input name="title" required minLength={2} maxLength={200} />
          </label>
          <div className="inline-form">
            <label className="field">
              <span>{tr("Kind")}</span>
              <select name="kind" defaultValue="other">
                {Object.entries(ENTRY_KINDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {tr(l)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{tr("Date")}</span>
              <input type="date" name="starts_on" required defaultValue={anchor} />
            </label>
            <label className="field">
              <span>{tr("Until (optional)")}</span>
              <input type="date" name="ends_on" />
            </label>
            <label className="field">
              <span>{tr("Time")}</span>
              <input type="time" name="at_time" />
            </label>
          </div>
          <div className="inline-form">
            <label className="field">
              <span>{tr("Who is reminded")}</span>
              <select name="owner_id" defaultValue={user.id}>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>{tr("Who sees it")}</span>
              <select name="private" defaultValue="0">
                <option value="0">{tr("The whole team")}</option>
                <option value="1">{tr("Only me and that person")}</option>
              </select>
            </label>
          </div>
          <label className="field">
            <span>{tr("Notes")}</span>
            <input name="notes" maxLength={1000} />
          </label>
          <SubmitButton className="btn btn-small btn-primary">{tr("Add")}</SubmitButton>
        </form>
      </details>

      <details className="card" id="phone">
        <summary>{tr("Phone calendar (Google Calendar, iPhone, Outlook)")}</summary>
        <p className="small muted">{tr("Your private link adds your dates to the calendar on your phone. It is one way: change dates here, and your phone shows them.")}</p>
        <FeedLink hasLink={!!link.data} kinds={((link.data as { kinds?: string[] } | null)?.kinds ?? []) as string[]} />
      </details>
    </>
  );
}
