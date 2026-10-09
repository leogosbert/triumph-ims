import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import { STEP_ROLES } from "@/lib/branches";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { formatDateTime } from "@/lib/format";
import { readNotice, type SearchParams } from "@/lib/messages";
import { formatMoney } from "@/lib/money";
import { namesFor } from "@/lib/people";
import { can, ROLE_LABELS, type Role } from "@/lib/roles";
import { saveSteps } from "./actions";

export const metadata = { title: "Approval steps" };

type Step = { step: number; role: Role; min_amount: number; label: string | null };
type Waiting = {
  id: string;
  number: string;
  total: number;
  currency: string;
  submitted_by: string | null;
  submitted_at: string | null;
  supplier: { name: string } | null;
  approvals: { step: number; role: Role; label: string | null; approved_at: string | null; approved_by: string | null }[];
};

export default async function ApprovalsPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role, user } = await getAppContext();
  if (!can(role, "seePurchasing")) redirect("/");
  const [{ data: stepData, error }, { data: poData }] = await Promise.all([
    supabase.from("approval_steps").select("step, role, min_amount, label").eq("company_id", company.id).eq("doc_type", "purchase_order").order("step"),
    supabase
      .from("purchase_orders")
      .select("id, number, total, currency, submitted_by, submitted_at, supplier:suppliers(name), approvals:po_approvals(step, role, label, approved_at, approved_by)")
      .eq("company_id", company.id)
      .eq("status", "pending_approval")
      .order("submitted_at")
      .limit(200),
  ]);
  if (isMissingTable(error)) return <NotReady title="Approval steps" />;
  if (error) throw new Error(error.message);
  const steps = (stepData ?? []) as Step[];
  const all = ((poData ?? []) as unknown as Waiting[]).map((p) => {
    const sorted = [...(p.approvals ?? [])].sort((a, b) => a.step - b.step);
    return { ...p, approvals: sorted, current: sorted.find((a) => !a.approved_at) };
  });
  // What this person can approve now (as the approve buttons on the order decide).
  const mine = all.filter(
    (p) =>
      p.submitted_by !== user.id &&
      (p.current
        ? (role === p.current.role || role === "management") && !p.approvals.some((a) => a.approved_by === user.id)
        : role === "management"),
  );
  const names = await namesFor(supabase, all.map((p) => p.submitted_by));
  const base = company.base_currency;
  const manage = can(role, "setApprovals");
  const roleName = (r: string) => tr(ROLE_LABELS[r as Role] ?? r);
  const rows = Array.from({ length: 6 }, (_, i) => steps[i]);

  return (
    <>
      <p className="small">
        <Link href="/purchase-orders">{tr("← Purchase orders")}</Link>
      </p>
      <h1>{tr("Approval steps")}</h1>
      <p className="muted small">
        {tr("Purchase orders above an amount need approval in steps, for example finance first, then management. Nobody approves their own order, and one person cannot approve two steps of the same order.")}
      </p>
      <Notice {...notice} />

      <section className="card">
        <h2>
          {tr("Waiting for you")} <span className="small muted">· {mine.length}</span>
        </h2>
        {mine.length === 0 ? (
          <p className="muted small">{tr("Nothing waiting for your approval.")}</p>
        ) : (
          <ul className="list">
            {mine.map((p) => (
              <li key={p.id}>
                <Link href={`/purchase-orders/${p.id}`}>
                  <strong>{p.number}</strong> · {p.supplier?.name}
                </Link>
                <div className="muted small">
                  {formatMoney(p.total, p.currency)}
                  {p.current && ` · ${tr("step")} ${p.current.step} ${tr("of")} ${p.approvals.length}${p.current.label ? ` (${p.current.label})` : ""}`}
                  {p.submitted_by && names.get(p.submitted_by) && ` · ${names.get(p.submitted_by)}`}
                  {p.submitted_at && ` · ${formatDateTime(p.submitted_at)}`}
                </div>
              </li>
            ))}
          </ul>
        )}
        {all.length > mine.length && (
          <p className="small muted">
            {all.length - mine.length} {tr("more waiting for other people.")}{" "}
            <Link href="/purchase-orders?tab=approval">{tr("See all")}</Link>
          </p>
        )}
      </section>

      <section className="card">
        <h2>{tr("Steps for purchase orders")}</h2>
        {!manage ? (
          steps.length === 0 ? (
            <p className="muted small">{tr("No steps: management approves orders above the company limit.")}</p>
          ) : (
            <ol className="small">
              {steps.map((s) => (
                <li key={s.step}>
                  {s.label ? `${s.label} · ` : ""}
                  {roleName(s.role)}
                  {Number(s.min_amount) > 0 && ` · ${tr("from")} ${formatMoney(s.min_amount, base)}`}
                </li>
              ))}
            </ol>
          )
        ) : (
          <form action={saveSteps}>
            <p className="small muted" style={{ marginTop: 0 }}>
              {tr("Each step applies to orders of at least its amount; 0 means every order. Leave a row empty to drop it. Without steps, management approves orders above the company limit as before.")}{" "}
              {tr("Amounts in")} {base}.
            </p>
            <div className="scroll-x">
              <table className="compare">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>{tr("Who approves")}</th>
                    <th>{tr("From amount")}</th>
                    <th>{tr("Name of the step")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s, i) => (
                    <tr key={i}>
                      <td>{i + 1}</td>
                      <td>
                        <select name={`role${i + 1}`} defaultValue={s?.role ?? ""} aria-label={tr("Who approves")}>
                          <option value="">—</option>
                          {STEP_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {roleName(r)}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input name={`min${i + 1}`} type="text" inputMode="decimal" defaultValue={s ? String(Number(s.min_amount)) : ""} aria-label={tr("From amount")} />
                      </td>
                      <td>
                        <input name={`label${i + 1}`} type="text" maxLength={80} defaultValue={s?.label ?? ""} placeholder={i === 0 ? tr("e.g. Budget check") : undefined} aria-label={tr("Name of the step")} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <SubmitButton>{tr("Save steps")}</SubmitButton>
          </form>
        )}
      </section>
    </>
  );
}
