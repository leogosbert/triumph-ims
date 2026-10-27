import Link from "next/link";
import { primeLang, tr } from "@/lib/tr";
import { Icon, type IconName } from "@/components/Icon";
import { canSeeCompliance } from "@/lib/compliance/model";
import { displayName, getAppContext } from "@/lib/context";
import { formatDate } from "@/lib/format";
import { num, thisYear, type AdminSummary, type LeaveBalance } from "@/lib/hr";
import { joinOpen, type MeetingSummary } from "@/lib/meetings/model";
import { moreMenu } from "@/lib/menu";
import { formatMoney } from "@/lib/money";
import { monthLabel } from "@/lib/payroll";
import { can, ROLE_LABELS, type Role } from "@/lib/roles";
import { daysFromToday, formatWhen, OPEN_JOB, todayTz } from "@/lib/services";

export const metadata = { title: "My page" };

/** One line in a card: what it is, a short detail, and something on the right (an amount, a date, a count). */
type Line = { key: string; href: string; title: string; sub?: string; side?: string; tone?: "bad" | "warn" | "ok" | "info" | "off" };
type Res<T> = { data: T | null; error: unknown };

/**
 * Reads quietly: a missing table or function (SQL not run yet), a switched-off feature or a refusal gives an
 * empty answer instead of breaking the page.
 */
async function safe<T>(q: PromiseLike<Res<T>> | null | false | undefined): Promise<T | null> {
  if (!q) return null;
  try {
    const { data, error } = await q;
    return error ? null : (data ?? null);
  } catch {
    return null;
  }
}
const list = <T,>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(iso: string) {
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((day + 6) % 7));
}

/** "Overdue 3 days", "Today", "In 2 days" or the date, with a colour. */
function due(date: string | null | undefined): { text: string; tone?: Line["tone"] } {
  const d = daysFromToday(date);
  if (d === null || !date) return { text: "" };
  if (d < 0) return { text: `${tr("Overdue")} ${-d} ${tr(-d === 1 ? "day" : "days")}`, tone: "bad" };
  if (d === 0) return { text: tr("Today"), tone: "warn" };
  if (d === 1) return { text: tr("Tomorrow"), tone: "warn" };
  if (d <= 7) return { text: `${tr("In")} ${d} ${tr("days")}`, tone: "info" };
  return { text: formatDate(date) };
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  return h < 12 ? tr("Good morning") : h < 17 ? tr("Good afternoon") : tr("Good evening");
}

/** The screens each role opens most, in order; only the ones this person can open (and whose feature is on) show. */
const SHORTCUTS: Record<Role, string[]> = {
  management: ["/approvals", "/quotations", "/purchase-orders", "/receivables", "/reports", "/meetings", "/settings"],
  sales: ["/rfqs", "/quotations", "/crm", "/clients", "/invoices", "/tenders", "/stock"],
  procurement: ["/requisitions", "/supplier-rfqs", "/purchase-orders", "/suppliers", "/stock/reorder", "/receiving"],
  warehouse: ["/receiving", "/stock", "/transfers", "/deliveries", "/requisitions", "/fleet"],
  driver: ["/driver", "/fleet", "/expenses/new", "/hse"],
  finance: ["/invoices", "/payments", "/bills", "/receivables", "/reconcile", "/expenses", "/payroll"],
};

function Card({ title, icon, more, lines, children }: { title: string; icon?: IconName; more?: { href: string; label: string }; lines?: Line[]; children?: React.ReactNode }) {
  return (
    <section className="card my-card">
      <div className="my-card-head">
        <h2>
          {icon && (
            <span className="my-card-icon" aria-hidden="true">
              <Icon name={icon} size={18} />
            </span>
          )}
          {title}
        </h2>
        {more && (
          <Link href={more.href} className="small">
            {more.label} →
          </Link>
        )}
      </div>
      {lines && lines.length > 0 && <Lines lines={lines} />}
      {children}
    </section>
  );
}

function Lines({ lines }: { lines: Line[] }) {
  return (
    <ul className="waitlist my-lines">
      {lines.map((l) => (
        <li key={l.key}>
          <Link href={l.href}>
            <span>
              <strong>{l.title}</strong>
              {l.sub && <span>{l.sub}</span>}
            </span>
            {l.side && <span className={l.tone ? `badge tone-${l.tone}` : "my-side"}>{l.side}</span>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

type Named = { name: string } | null;
type CalItem = { uid: string; date: string; time?: string | null; kind: string; title: string; notes?: string | null; href?: string | null };

export default async function MyPage() {
  await primeLang();
  const { supabase, user, profile, company, role, isManager, features, membership } = await getAppContext();
  const cid = company.id;
  const me = user.id;
  const on = features.on;
  const today = todayTz();
  const in7 = addDays(today, 7);
  const in14 = addDays(today, 14);
  const in30 = addDays(today, 30);
  const week = mondayOf(today);
  const c = (p: Parameters<typeof can>[1]) => can(role, p);
  const adminOn = on("hr_people") || on("timesheet_approval") || on("hse") || on("quality");

  const [
    quotesToApprove,
    posWaiting,
    reqsToApprove,
    meetingSum,
    admin,
    meetingActions,
    correctiveActions,
    myOpps,
    tenderTasks,
    followups,
    myDeadlines,
    licences,
    myDocs,
    myRfqs,
    myQuotes,
    overdueInvoices,
    posUnconfirmed,
    supplierRfqs,
    reqsToOrder,
    posToReceive,
    transfers,
    myDeliveries,
    billsDue,
    unchecked,
    myJobs,
    todayItems,
    employee,
    payslips,
    weekHours,
    weekStatus,
    notices,
    factors,
  ] = await Promise.all([
    // ---- Needs me now: approvals ----
    c("approveQuotes") && on("quotations")
      ? safe(
          supabase
            .from("quotations")
            .select("id, number, revision, total, currency, client:clients(name)")
            .eq("company_id", cid)
            .eq("status", "pending_approval")
            .neq("submitted_by", me)
            .order("submitted_at")
            .limit(8),
        )
      : null,
    c("seePurchasing") && on("purchases")
      ? safe(
          supabase
            .from("purchase_orders")
            .select("id, number, total, currency, submitted_by, supplier:suppliers(name), approvals:po_approvals(step, role, approved_at, approved_by)")
            .eq("company_id", cid)
            .eq("status", "pending_approval")
            .order("submitted_at")
            .limit(40),
        )
      : null,
    isManager && on("requisitions")
      ? safe(supabase.from("requisitions").select("id, number, reason, needed_by").eq("company_id", cid).eq("status", "submitted").order("submitted_at").limit(8))
      : null,
    on("meetings") ? safe(supabase.rpc("meeting_summary", { p_company: cid })) : null,
    adminOn ? safe(supabase.rpc("admin_summary", { p_company: cid })) : null,
    // ---- Needs me now: things assigned to me ----
    on("meetings")
      ? safe(
          supabase
            .from("meeting_points")
            .select("id, body, due_on, meeting:meetings(title)")
            .eq("company_id", cid)
            .eq("owner_id", me)
            .eq("approved", true)
            .eq("kind", "action")
            .in("status", ["open", "in_progress"])
            .order("due_on", { ascending: true, nullsFirst: false })
            .limit(6),
        )
      : null,
    on("hse") || on("quality")
      ? safe(
          supabase
            .from("corrective_actions")
            .select("id, action, due_on, source_kind, source_id")
            .eq("company_id", cid)
            .eq("owner_id", me)
            .eq("status", "open")
            .order("due_on", { ascending: true, nullsFirst: false })
            .limit(5),
        )
      : null,
    c("seeCrm") && on("crm_pipeline")
      ? safe(
          supabase
            .from("opportunities")
            .select("id, title, next_action, next_on, prospect_name, client:clients(name)")
            .eq("company_id", cid)
            .eq("owner_id", me)
            .not("stage", "in", "(won,lost)")
            .lte("next_on", in7)
            .order("next_on")
            .limit(5),
        )
      : null,
    c("seeCrm") && on("tenders")
      ? safe(
          supabase
            .from("tender_tasks")
            .select("id, title, due_on, tender_id, tender:tenders(number, title)")
            .eq("company_id", cid)
            .eq("assigned_to", me)
            .is("done_at", null)
            .lte("due_on", in14)
            .order("due_on")
            .limit(5),
        )
      : null,
    (c("followUpQuotes") || c("followUpInvoices")) && on("reminders")
      ? safe(
          supabase
            .from("followups")
            .select("id, next_on, note, quotation:quotations(id, number, status, client:clients(name)), invoice:invoices(id, number, status, client:clients(name))")
            .eq("company_id", cid)
            .eq("created_by", me)
            .gte("next_on", addDays(today, -14))
            .lte("next_on", today)
            .order("next_on")
            .limit(10),
        )
      : null,
    canSeeCompliance(role) && on("compliance")
      ? safe(
          supabase
            .from("compliance_deadlines")
            .select("id, due_on, item:compliance_items!inner(name, owner_id)")
            .eq("company_id", cid)
            .eq("status", "open")
            .eq("item.owner_id", me)
            .lte("due_on", in14)
            .order("due_on")
            .limit(5),
        )
      : null,
    isManager && on("compliance")
      ? safe(
          supabase
            .from("licences")
            .select("id, name, expires_on")
            .eq("company_id", cid)
            .in("status", ["active", "expired"])
            .lte("expires_on", in30)
            .order("expires_on")
            .limit(5),
        )
      : null,
    c("seeDocuments") && on("documents")
      ? safe(
          supabase
            .from("documents")
            .select("id, title, expires_on")
            .eq("company_id", cid)
            .eq("created_by", me)
            .is("archived_at", null)
            .gte("expires_on", addDays(today, -30))
            .lte("expires_on", in30)
            .order("expires_on")
            .limit(5),
        )
      : null,
    // ---- My work ----
    c("seeSales") && on("client_rfqs")
      ? safe(
          supabase
            .from("rfqs")
            .select("id, number, title, due_on, client:clients(name)")
            .eq("company_id", cid)
            .eq("assigned_to", me)
            .in("status", ["new", "quoting"])
            .order("due_on", { ascending: true, nullsFirst: false })
            .limit(6),
        )
      : null,
    c("editSales") && on("quotations")
      ? safe(
          supabase
            .from("quotations")
            .select("id, number, revision, status, valid_until, total, currency, client:clients(name)")
            .eq("company_id", cid)
            .eq("created_by", me)
            .in("status", ["draft", "pending_approval", "approved", "sent"])
            .order("updated_at", { ascending: false })
            .limit(6),
        )
      : null,
    (role === "sales" || role === "finance") && on("invoices")
      ? safe(
          role === "sales"
            ? supabase
                .from("invoices")
                .select("id, number, due_date, total, amount_paid, currency, client:clients(name), quotation:quotations!inner(created_by)")
                .eq("company_id", cid)
                .eq("quotation.created_by", me)
                .in("status", ["issued", "partly_paid"])
                .lt("due_date", today)
                .order("due_date")
                .limit(6)
            : supabase
                .from("invoices")
                .select("id, number, due_date, total, amount_paid, currency, client:clients(name)")
                .eq("company_id", cid)
                .in("status", ["issued", "partly_paid"])
                .lt("due_date", today)
                .order("due_date")
                .limit(6),
        )
      : null,
    role === "procurement" && on("purchases")
      ? safe(
          supabase
            .from("purchase_orders")
            .select("id, number, sent_at, supplier:suppliers(name)")
            .eq("company_id", cid)
            .eq("status", "sent")
            .order("sent_at")
            .limit(6),
        )
      : null,
    role === "procurement" && on("supplier_rfqs")
      ? safe(supabase.from("supplier_rfqs").select("id, number, title, due_on").eq("company_id", cid).eq("status", "open").order("due_on", { ascending: true, nullsFirst: false }).limit(5))
      : null,
    role === "procurement" && on("requisitions")
      ? safe(supabase.from("requisitions").select("id, number, reason, needed_by").eq("company_id", cid).eq("status", "approved").order("needed_by", { ascending: true, nullsFirst: false }).limit(5))
      : null,
    role === "warehouse" && on("goods_received")
      ? safe(
          supabase
            .from("purchase_orders")
            .select("id, number, status, expected_date, supplier:suppliers(name)")
            .eq("company_id", cid)
            .in("status", ["sent", "confirmed", "partially_received"])
            .order("expected_date", { ascending: true, nullsFirst: false })
            .limit(6),
        )
      : null,
    role === "warehouse" && on("stock_transfers")
      ? safe(supabase.from("stock_transfers").select("id, number, status, reason").eq("company_id", cid).in("status", ["draft", "in_transit"]).order("created_at").limit(6))
      : null,
    role === "driver" && on("deliveries")
      ? safe(
          supabase
            .from("deliveries")
            .select("id, number, planned_date, delivery_site, client:clients(name)")
            .eq("company_id", cid)
            .eq("driver_id", me)
            .eq("status", "dispatched")
            .order("planned_date", { ascending: true, nullsFirst: false })
            .limit(8),
        )
      : null,
    role === "finance" && on("supplier_bills")
      ? safe(
          supabase
            .from("supplier_bills")
            .select("id, number, supplier_invoice_no, due_date, total, amount_paid, currency, supplier:suppliers(name)")
            .eq("company_id", cid)
            .in("status", ["open", "partly_paid"])
            .lte("due_date", in7)
            .order("due_date")
            .limit(6),
        )
      : null,
    role === "finance" && on("mobile_money")
      ? (async () => {
          try {
            const { count, error } = await supabase
              .from("payments")
              .select("id", { count: "exact", head: true })
              .eq("company_id", cid)
              .is("voided_at", null)
              .is("reconciled_at", null)
              .gte("received_on", addDays(today, -60));
            return error ? 0 : (count ?? 0);
          } catch {
            return 0;
          }
        })()
      : 0,
    on("service_jobs")
      ? safe(
          supabase
            .from("service_jobs")
            .select("id, number, title, scheduled_for, client:clients(name)")
            .eq("company_id", cid)
            .contains("assigned_to", [me])
            .in("status", OPEN_JOB)
            .order("scheduled_for", { ascending: true, nullsFirst: false })
            .limit(5),
        )
      : null,
    // ---- My day ----
    on("calendar") || on("meetings")
      ? safe(supabase.rpc("calendar_items", { p_company: cid, p_from: today, p_to: today, p_kinds: ["meeting", "entry", "action", "delivery"] }))
      : null,
    // ---- Me as an employee ----
    on("hr_people")
      ? (async () => {
          const id = await safe<string>(supabase.rpc("my_employee_id", { p_company: cid }));
          if (!id) return null;
          const [row, balance] = await Promise.all([
            safe<{ job_title: string | null; department: string | null }>(supabase.from("employees").select("job_title, department").eq("id", id).maybeSingle()),
            safe<LeaveBalance>(supabase.rpc("leave_balance", { p_employee: id, p_year: thisYear() })),
          ]);
          return { id, row, balance };
        })()
      : null,
    on("payroll") ? safe(supabase.rpc("my_payslips", { p_company: cid })) : null,
    on("timesheets")
      ? safe(supabase.from("timesheets").select("hours").eq("company_id", cid).eq("user_id", me).gte("work_date", week).lte("work_date", addDays(week, 6)).limit(500))
      : null,
    on("timesheet_approval")
      ? safe(supabase.from("timesheet_weeks").select("status").eq("company_id", cid).eq("user_id", me).eq("week_start", week).maybeSingle())
      : null,
    // ---- Notices and security ----
    on("notifications")
      ? safe(supabase.from("notifications").select("id, title, body, link, severity, created_at").eq("company_id", cid).eq("user_id", me).is("read_at", null).order("created_at", { ascending: false }).limit(5))
      : null,
    (async () => {
      try {
        const { data } = await supabase.auth.mfa.listFactors();
        return (data?.totp ?? []).filter((f) => f.status === "verified").length;
      } catch {
        return null;
      }
    })(),
  ]);

  const ms = (meetingSum && typeof meetingSum === "object" ? meetingSum : null) as MeetingSummary | null;
  const as = (admin && typeof admin === "object" ? admin : null) as AdminSummary | null;

  // ---------- Needs me now ----------
  const approvals: Line[] = [];
  for (const q of list<{ id: string; number: string; revision: number; total: number; currency: string; client: Named }>(quotesToApprove)) {
    approvals.push({ key: `q${q.id}`, href: `/quotations/${q.id}`, title: `${tr("Quotation")} ${q.revision > 0 ? `${q.number}-R${q.revision}` : q.number}`, sub: q.client?.name ?? "", side: formatMoney(q.total, q.currency) });
  }
  type Po = { id: string; number: string; total: number; currency: string; submitted_by: string | null; supplier: Named; approvals: { step: number; role: Role; approved_at: string | null; approved_by: string | null }[] | null };
  for (const p of list<Po>(posWaiting)) {
    // Same rule as the approve buttons (and the Approval steps page): never your own order, one step per person.
    const steps = [...(p.approvals ?? [])].sort((a, b) => a.step - b.step);
    const current = steps.find((s) => !s.approved_at);
    const mine =
      p.submitted_by !== me &&
      (current ? (role === current.role || role === "management") && !steps.some((s) => s.approved_by === me) : role === "management");
    if (mine) approvals.push({ key: `p${p.id}`, href: `/purchase-orders/${p.id}`, title: `${tr("Purchase order")} ${p.number}`, sub: p.supplier?.name ?? "", side: formatMoney(p.total, p.currency) });
  }
  for (const r of list<{ id: string; number: string; reason: string | null; needed_by: string | null }>(reqsToApprove)) {
    const d = due(r.needed_by);
    approvals.push({ key: `r${r.id}`, href: `/requisitions/${r.id}`, title: `${tr("Purchase request")} ${r.number}`, sub: r.reason ?? "", side: d.text ? `${tr("Needed")} ${d.text.toLowerCase()}` : undefined });
  }
  if (as?.manager) {
    if (on("hr_people") && num(as.leave_waiting) > 0) approvals.push({ key: "leave", href: "/hr/leave", title: tr("Leave requests"), sub: tr("Waiting for your decision"), side: String(num(as.leave_waiting)), tone: "warn" });
    if (on("timesheet_approval") && num(as.weeks_waiting) > 0) approvals.push({ key: "weeks", href: "/timesheets/approve", title: tr("Timesheets"), sub: tr("Weeks submitted by the team"), side: String(num(as.weeks_waiting)), tone: "warn" });
  }
  if (ms?.is_manager) {
    if (ms.proposals > 0) approvals.push({ key: "props", href: "/meetings?tab=held", title: tr("Meeting updates to review"), sub: tr("Updates from the team waiting for approval"), side: String(ms.proposals), tone: "warn" });
    if (ms.requests > 0) approvals.push({ key: "reqs", href: "/meetings/invitations", title: tr("Meeting requests"), sub: tr("Clients and suppliers asking for a meeting"), side: String(ms.requests), tone: "warn" });
  }
  if (ms?.can_organise && ms.to_approve > 0) approvals.push({ key: "minutes", href: "/meetings?tab=held", title: tr("Minutes to finish"), sub: tr("Meetings you chair or organised"), side: String(ms.to_approve), tone: "info" });

  const tasks: Line[] = [];
  for (const a of list<{ id: string; body: string; due_on: string | null; meeting: { title: string } | null }>(meetingActions)) {
    const d = due(a.due_on);
    tasks.push({ key: `a${a.id}`, href: "/meetings/actions", title: a.body.length > 90 ? `${a.body.slice(0, 88)}…` : a.body, sub: a.meeting ? `${tr("Meeting")}: ${a.meeting.title}` : tr("Meeting action"), side: d.text || undefined, tone: d.tone });
  }
  const SOURCE: Record<string, { href: (id: string) => string; label: string }> = {
    incident: { href: (id) => `/hse/${id}`, label: "Incident" },
    inspection: { href: (id) => `/hse/inspections/${id}`, label: "Inspection" },
    ncr: { href: (id) => `/quality/${id}`, label: "NCR" },
  };
  for (const a of list<{ id: string; action: string; due_on: string | null; source_kind: string; source_id: string }>(correctiveActions)) {
    const d = due(a.due_on);
    const s = SOURCE[a.source_kind];
    tasks.push({ key: `c${a.id}`, href: s ? s.href(a.source_id) : "/hse", title: a.action, sub: `${tr("Corrective action")}${s ? ` · ${tr(s.label)}` : ""}`, side: d.text || undefined, tone: d.tone });
  }
  for (const o of list<{ id: string; title: string; next_action: string | null; next_on: string | null; prospect_name: string | null; client: Named }>(myOpps)) {
    const d = due(o.next_on);
    tasks.push({ key: `o${o.id}`, href: `/crm/${o.id}`, title: o.next_action || `${tr("Follow up")}: ${o.title}`, sub: [o.client?.name ?? o.prospect_name, o.title].filter(Boolean).join(" · "), side: d.text || undefined, tone: d.tone });
  }
  for (const t of list<{ id: string; title: string; due_on: string | null; tender_id: string; tender: { number: string; title: string } | null }>(tenderTasks)) {
    const d = due(t.due_on);
    tasks.push({ key: `t${t.id}`, href: `/tenders/${t.tender_id}`, title: t.title, sub: `${tr("Tender")} ${t.tender?.number ?? ""} ${t.tender?.title ?? ""}`.trim(), side: d.text || undefined, tone: d.tone });
  }
  type Doc = { id: string; number: string; status: string; client: Named } | null;
  const seenDocs = new Set<string>();
  for (const f of list<{ id: string; next_on: string; note: string | null; quotation: Doc; invoice: Doc }>(followups)) {
    // Only documents still open: a quotation waiting for the client, an invoice not yet paid.
    const q = f.quotation && ["approved", "sent"].includes(f.quotation.status) ? f.quotation : null;
    const i = f.invoice && ["issued", "partly_paid"].includes(f.invoice.status) ? f.invoice : null;
    const doc = q ?? i;
    if (!doc || seenDocs.has(doc.id)) continue;
    seenDocs.add(doc.id);
    const d = due(f.next_on);
    tasks.push({
      key: `f${f.id}`,
      href: q ? `/quotations/${doc.id}#follow-up` : `/invoices/${doc.id}#remind`,
      title: `${tr(q ? "Follow up quotation" : "Chase payment of")} ${doc.number}`,
      sub: [doc.client?.name, f.note].filter(Boolean).join(" · "),
      side: d.text || undefined,
      tone: d.tone,
    });
  }

  const papers: Line[] = [];
  for (const x of list<{ id: string; due_on: string; item: { name: string } | null }>(myDeadlines)) {
    const d = due(x.due_on);
    papers.push({ key: `d${x.id}`, href: "/compliance/calendar", title: `${tr("File")}: ${tr(x.item?.name ?? "")}`, sub: tr("Compliance item you are responsible for"), side: d.text || undefined, tone: d.tone });
  }
  for (const l of list<{ id: string; name: string; expires_on: string }>(licences)) {
    const d = due(l.expires_on);
    papers.push({ key: `l${l.id}`, href: `/compliance/licences/${l.id}`, title: l.name, sub: tr(d.tone === "bad" ? "Licence expired" : "Licence expiring"), side: d.text || formatDate(l.expires_on), tone: d.tone ?? "warn" });
  }
  for (const x of list<{ id: string; title: string; expires_on: string }>(myDocs)) {
    const d = due(x.expires_on);
    papers.push({ key: `x${x.id}`, href: `/documents/${x.id}`, title: x.title, sub: tr(d.tone === "bad" ? "Document expired" : "Document expiring"), side: d.text || formatDate(x.expires_on), tone: d.tone ?? "warn" });
  }
  if (as) {
    if (on("timesheet_approval") && num(as.my_week_returned) > 0) tasks.push({ key: "returned", href: "/timesheets", title: tr("Timesheet sent back"), sub: tr("Correct it and send it again"), side: String(num(as.my_week_returned)), tone: "warn" });
    if (on("hr_people") && num(as.my_certs_expiring) > 0) papers.push({ key: "certs", href: "/hr", title: tr("My certificates expiring"), sub: tr("Within 30 days"), side: String(num(as.my_certs_expiring)), tone: "warn" });
  }

  // ---------- My work ----------
  const work: { title: string; icon: IconName; more: { href: string; label: string }; lines: Line[] }[] = [];
  const push = (title: string, icon: IconName, href: string, lines: Line[]) => {
    if (lines.length) work.push({ title, icon, more: { href, label: tr("All") }, lines });
  };
  push(
    tr("My client RFQs"),
    "inbox",
    "/rfqs",
    list<{ id: string; number: string; title: string | null; due_on: string | null; client: Named }>(myRfqs).map((r) => {
      const d = due(r.due_on);
      return { key: r.id, href: `/rfqs/${r.id}`, title: r.client?.name ?? r.number, sub: [r.number, r.title].filter(Boolean).join(" · "), side: d.text ? `${tr("Quote due")} ${d.text.toLowerCase()}` : undefined, tone: d.tone };
    }),
  );
  const QS: Record<string, string> = { draft: "Draft", pending_approval: "Waiting for approval", approved: "Approved, not sent", sent: "Sent to client" };
  push(
    tr("My open quotations"),
    "doc",
    "/quotations",
    list<{ id: string; number: string; revision: number; status: string; valid_until: string | null; total: number; currency: string; client: Named }>(myQuotes).map((q) => {
      const expired = q.status === "sent" && q.valid_until && q.valid_until < today;
      return {
        key: q.id,
        href: `/quotations/${q.id}`,
        title: q.client?.name ?? q.number,
        sub: `${q.revision > 0 ? `${q.number}-R${q.revision}` : q.number} · ${tr(QS[q.status] ?? q.status)}${q.valid_until && q.status === "sent" ? ` · ${tr(expired ? "expired" : "valid until")} ${formatDate(q.valid_until)}` : ""}`,
        side: formatMoney(q.total, q.currency),
      };
    }),
  );
  push(
    role === "sales" ? tr("My clients' overdue invoices") : tr("Overdue invoices"),
    "receipt",
    "/invoices?tab=overdue",
    list<{ id: string; number: string; due_date: string; total: number; amount_paid: number; currency: string; client: Named }>(overdueInvoices).map((i) => ({
      key: i.id,
      href: `/invoices/${i.id}`,
      title: i.client?.name ?? i.number,
      sub: `${i.number} · ${due(i.due_date).text}`,
      side: formatMoney(Number(i.total) - Number(i.amount_paid), i.currency),
      tone: "bad" as const,
    })),
  );
  push(
    tr("Waiting for supplier confirmation"),
    "purchasing",
    "/purchase-orders?tab=incoming",
    list<{ id: string; number: string; sent_at: string | null; supplier: Named }>(posUnconfirmed).map((p) => ({
      key: p.id,
      href: `/purchase-orders/${p.id}`,
      title: p.supplier?.name ?? p.number,
      sub: `${p.number}${p.sent_at ? ` · ${tr("sent")} ${formatDate(p.sent_at)}` : ""}`,
    })),
  );
  push(
    tr("Supplier RFQs collecting prices"),
    "inbox",
    "/supplier-rfqs",
    list<{ id: string; number: string; title: string | null; due_on: string | null }>(supplierRfqs).map((r) => {
      const d = due(r.due_on);
      return { key: r.id, href: `/supplier-rfqs/${r.id}`, title: r.title || r.number, sub: r.number, side: d.text ? `${tr("Closes")} ${d.text.toLowerCase()}` : undefined, tone: d.tone };
    }),
  );
  push(
    tr("Approved requests to order"),
    "check",
    "/requisitions?view=order",
    list<{ id: string; number: string; reason: string | null; needed_by: string | null }>(reqsToOrder).map((r) => {
      const d = due(r.needed_by);
      return { key: r.id, href: `/requisitions/${r.id}`, title: r.number, sub: r.reason ?? "", side: d.text || undefined, tone: d.tone };
    }),
  );
  const POS: Record<string, string> = { sent: "Sent", confirmed: "Confirmed", partially_received: "Partly received" };
  push(
    tr("Goods to receive"),
    "stock",
    "/receiving",
    list<{ id: string; number: string; status: string; expected_date: string | null; supplier: Named }>(posToReceive).map((p) => {
      const d = due(p.expected_date);
      return { key: p.id, href: `/purchase-orders/${p.id}/receive`, title: p.supplier?.name ?? p.number, sub: `${p.number} · ${tr(POS[p.status] ?? p.status)}`, side: d.text || undefined, tone: d.tone };
    }),
  );
  push(
    tr("Stock transfers"),
    "warehouse",
    "/transfers",
    list<{ id: string; number: string; status: string; reason: string | null }>(transfers).map((t) => ({
      key: t.id,
      href: `/transfers/${t.id}`,
      title: t.number,
      sub: t.reason ?? "",
      side: tr(t.status === "in_transit" ? "To receive" : "To send"),
      tone: t.status === "in_transit" ? ("warn" as const) : ("info" as const),
    })),
  );
  push(
    tr("My deliveries"),
    "deliveries",
    "/driver",
    list<{ id: string; number: string; planned_date: string | null; delivery_site: string | null; client: Named }>(myDeliveries).map((d) => {
      const w = due(d.planned_date);
      return { key: d.id, href: `/driver?d=${d.id}`, title: d.client?.name ?? d.number, sub: [d.number, d.delivery_site].filter(Boolean).join(" · "), side: w.text || undefined, tone: w.tone };
    }),
  );
  push(
    tr("Supplier bills due"),
    "receipt",
    "/bills?tab=open",
    list<{ id: string; number: string; supplier_invoice_no: string | null; due_date: string | null; total: number; amount_paid: number; currency: string; supplier: Named }>(billsDue).map((b) => {
      const d = due(b.due_date);
      return { key: b.id, href: `/bills/${b.id}`, title: b.supplier?.name ?? b.number, sub: `${b.supplier_invoice_no || b.number} · ${d.text}`, side: formatMoney(Number(b.total) - Number(b.amount_paid), b.currency), tone: d.tone };
    }),
  );
  if (unchecked > 0) {
    push(tr("Payments to check"), "check", "/reconcile", [
      { key: "unchecked", href: "/reconcile", title: tr("Payments not yet ticked against the statement"), sub: tr("Last 60 days"), side: String(unchecked), tone: "warn" },
    ]);
  }
  push(
    tr("My service jobs"),
    "tools",
    "/jobs",
    list<{ id: string; number: string; title: string | null; scheduled_for: string | null; client: Named }>(myJobs).map((j) => ({
      key: j.id,
      href: `/jobs/${j.id}`,
      title: j.client?.name ?? j.number,
      sub: [j.number, j.title].filter(Boolean).join(" · "),
      side: j.scheduled_for ? formatWhen(j.scheduled_for) : undefined,
    })),
  );

  // ---------- My day ----------
  const items = list<CalItem>(todayItems).sort((a, b) => String(a.time ?? "99").localeCompare(String(b.time ?? "99")));
  const next = ms?.next ?? null;
  const nextIsToday = next ? new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(new Date(next.starts_at)) === today : false;
  const canJoin = next ? joinOpen({ status: next.status as "planned", starts_at: next.starts_at }) : false;

  // ---------- Me as an employee ----------
  const slips = list<{ line_id: string; period: string; net: number; status: string }>(payslips);
  const slip = slips[0] ?? null;
  const hours = list<{ hours: number }>(weekHours).reduce((s, r) => s + Number(r.hours), 0);
  const weekState = (weekStatus as { status?: string } | null)?.status ?? null;
  const bal = employee?.balance ?? null;
  const showEmployee = Boolean(employee || slip || weekHours);

  const noticeRows = list<{ id: string; title: string; body: string | null; link: string | null; severity: string; created_at: string }>(notices);

  // ---------- Shortcuts ----------
  const menu = moreMenu(role, isManager, { on, features: features.list }).flatMap((cat) => cat.items);
  const shortcuts = SHORTCUTS[role]
    .map((href) => menu.find((i) => i.href === href))
    .filter((i): i is NonNullable<typeof i> => Boolean(i))
    .slice(0, 6);

  const needsCount = approvals.length + tasks.length + papers.length;
  const allClear = needsCount === 0 && work.length === 0 && items.length === 0 && !(next && nextIsToday);

  const dateLine = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }).format(new Date());
  const jobLine = [employee?.row?.job_title, employee?.row?.department].filter(Boolean).join(" · ");
  const firstName = displayName(profile).split(" ")[0];

  return (
    <>
      <section className="hero my-hero">
        <div className="hero-date">{dateLine}</div>
        <h1>
          {greeting()}, {firstName}
        </h1>
        <div className="my-hero-roles">
          <span className="my-chip">{tr(ROLE_LABELS[role])}</span>
          {jobLine && <span className="my-chip">{jobLine}</span>}
          <span className="my-chip my-chip-plain">{membership.company.name}</span>
        </div>
        {needsCount > 0 && (
          <p className="my-hero-sum">
            <a href="#needs">
              {needsCount} {tr(needsCount === 1 ? "thing needs you now" : "things need you now")} ↓
            </a>
          </p>
        )}
      </section>

      <div className="my-grid">
        <div className="my-col">
          {allClear && (
            <section className="card my-clear">
              <span className="my-clear-icon" aria-hidden="true">
                <Icon name="check" size={26} />
              </span>
              <div>
                <h2>{tr("All clear")}</h2>
                <p className="muted small">{tr("Nothing is waiting for you right now. New approvals, tasks and deadlines for you will show here.")}</p>
              </div>
            </section>
          )}

          {needsCount > 0 && (
            <section className="card my-card my-needs" id="needs">
              <div className="my-card-head">
                <h2>
                  <span className="my-card-icon" aria-hidden="true">
                    <Icon name="bell" size={18} />
                  </span>
                  {tr("Needs me now")}
                </h2>
              </div>
              {approvals.length > 0 && (
                <>
                  <h3 className="my-sub">{tr("Waiting for my approval")}</h3>
                  <Lines lines={approvals} />
                </>
              )}
              {tasks.length > 0 && (
                <>
                  <h3 className="my-sub">{tr("My tasks and follow-ups")}</h3>
                  <Lines lines={tasks} />
                </>
              )}
              {papers.length > 0 && (
                <>
                  <h3 className="my-sub">{tr("Deadlines and papers")}</h3>
                  <Lines lines={papers} />
                </>
              )}
            </section>
          )}

          {work.map((w) => (
            <Card key={w.title} title={w.title} icon={w.icon} more={w.more} lines={w.lines} />
          ))}
        </div>

        <div className="my-col">
          {(items.length > 0 || next) && (
            <Card title={tr("My day")} icon="clock" more={on("calendar") ? { href: "/calendar", label: tr("Calendar") } : undefined}>
              {next && (
                <div className="my-next">
                  <div className="my-next-text">
                    <span className="small muted">{next.status === "live" ? tr("Live now") : tr("Next meeting")}</span>
                    <strong>{next.title}</strong>
                    <span className="small">{formatWhen(next.starts_at)}</span>
                  </div>
                  {canJoin ? (
                    <Link href={`/meetings/${next.id}/room`} className="btn btn-small btn-primary">
                      {tr("Join")}
                    </Link>
                  ) : (
                    <Link href={`/meetings/${next.id}`} className="btn btn-small">
                      {tr("Open")}
                    </Link>
                  )}
                </div>
              )}
              {items.length > 0 ? (
                <ul className="my-day">
                  {items.map((it) => (
                    <li key={it.uid} className={`my-day-${it.kind}`}>
                      <Link href={it.href ?? "/calendar"}>
                        <span className="my-day-time">{it.time ? it.time.split("-")[0] : tr("All day")}</span>
                        <span className="my-day-what">
                          <strong>{tr(it.title)}</strong>
                          {it.notes && <span className="small muted">{tr(it.notes)}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted small" style={{ marginBottom: 0 }}>
                  {tr("Nothing else in the calendar for today.")}
                </p>
              )}
            </Card>
          )}

          {showEmployee && (
            <Card title={tr("Me at work")} icon="user" more={on("hr_people") ? { href: "/hr", label: tr("My file") } : undefined}>
              <div className="my-tiles">
                {bal && (
                  <Link href="/hr/leave" className="my-tile">
                    <span className="n">{num(bal.left)}</span>
                    <span className="l">
                      {tr("leave days left")} · {tr("of")} {num(bal.entitled)}
                    </span>
                    {num(bal.waiting) > 0 && (
                      <span className="badge tone-warn">
                        {num(bal.waiting)} {tr("waiting")}
                      </span>
                    )}
                  </Link>
                )}
                {slip && (
                  <Link href={`/payroll/slip/${slip.line_id}`} className="my-tile">
                    <span className="n">{formatMoney(slip.net, company.base_currency)}</span>
                    <span className="l">
                      {tr("Latest payslip")} · {monthLabel(slip.period, tr)}
                    </span>
                  </Link>
                )}
                {weekHours && (
                  <Link href="/timesheets" className="my-tile">
                    <span className="n">{Math.round(hours * 10) / 10}</span>
                    <span className="l">{tr("hours this week")}</span>
                    {weekState && (
                      <span className={`badge tone-${weekState === "approved" ? "ok" : weekState === "returned" ? "bad" : "info"}`}>
                        {tr(weekState === "approved" ? "Approved" : weekState === "returned" ? "Sent back" : "Submitted")}
                      </span>
                    )}
                  </Link>
                )}
              </div>
              <p className="small my-links">
                {on("hr_people") && <Link href="/hr/leave">{tr("Ask for leave")}</Link>}
                {slips.length > 0 && <Link href="/payroll/my">{tr("All payslips")}</Link>}
              </p>
            </Card>
          )}

          {noticeRows.length > 0 && (
            <Card
              title={tr("Notices for me")}
              icon="bell"
              more={{ href: "/notifications", label: tr("All") }}
              lines={noticeRows.map((n) => ({
                key: n.id,
                href: n.link && n.link.startsWith("/") ? n.link : "/notifications",
                title: tr(n.title),
                sub: n.body ? (n.body.length > 100 ? `${n.body.slice(0, 98)}…` : n.body) : formatWhen(n.created_at),
                side: n.severity === "critical" || n.severity === "warning" ? tr(n.severity === "critical" ? "Urgent" : "Important") : undefined,
                tone: n.severity === "critical" ? ("bad" as const) : n.severity === "warning" ? ("warn" as const) : undefined,
              }))}
            />
          )}

          {shortcuts.length > 0 && (
            <section className="card my-card">
              <h2>{tr("My shortcuts")}</h2>
              <div className="my-shortcuts">
                {shortcuts.map((s) => (
                  <Link key={s.href} href={s.href}>
                    <span className="my-shortcut-icon" aria-hidden="true">
                      <Icon name={s.icon} size={20} />
                    </span>
                    <span>{tr(s.title)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="card my-card">
            <h2>{tr("Sign-in and security")}</h2>
            <ul className="waitlist my-lines">
              <li>
                <Link href="/account#security">
                  <span>
                    <strong>{tr("Two-step verification")}</strong>
                    <span>{factors ? tr("A code from your phone is asked when you sign in") : tr("Add a code from your phone to protect your account")}</span>
                  </span>
                  <span className={`badge tone-${factors ? "ok" : "warn"}`}>{factors ? tr("On") : tr("Off")}</span>
                </Link>
              </li>
              {user.last_sign_in_at && (
                <li>
                  <Link href="/account#security">
                    <span>
                      <strong>{tr("Last sign-in")}</strong>
                      <span>{formatWhen(user.last_sign_in_at)}</span>
                    </span>
                  </Link>
                </li>
              )}
              <li>
                <Link href="/account">
                  <span>
                    <strong>{tr("My account")}</strong>
                    <span>{tr("Your details, password, appearance, sign out")}</span>
                  </span>
                  <span className="my-side">→</span>
                </Link>
              </li>
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
