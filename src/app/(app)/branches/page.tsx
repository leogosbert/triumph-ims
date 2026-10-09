import { primeLang, tr } from "@/lib/tr";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Notice } from "@/components/Notice";
import { NotReady } from "@/components/NotReady";
import { SubmitButton } from "@/components/SubmitButton";
import type { Branch } from "@/lib/branches";
import { getAppContext } from "@/lib/context";
import { isMissingTable } from "@/lib/crm";
import { readNotice, type SearchParams } from "@/lib/messages";
import { namesFor } from "@/lib/people";
import { can, ROLE_LABELS, type Role } from "@/lib/roles";
import { assignBranches, createBranch, removeBranch, saveBranch } from "./actions";

export const metadata = { title: "Branches" };

type Member = { id: string; user_id: string; role: Role; branch_id: string | null };
type Store = { id: string; code: string; name: string; active: boolean; branch_id: string | null };

function BranchFields({ b, members, names }: { b?: Branch; members: Member[]; names: Map<string, string> }) {
  const key = b?.id ?? "new";
  return (
    <div className="grid grid-2">
      <div className="field">
        <label htmlFor={`name-${key}`}>{tr("Name")}</label>
        <input id={`name-${key}`} name="name" type="text" required minLength={2} maxLength={120} defaultValue={b?.name ?? ""} placeholder={tr("e.g. Arusha")} />
      </div>
      <div className="field">
        <label htmlFor={`code-${key}`}>
          {tr("Code")} <span className="hint">{tr("· optional, e.g. ARU")}</span>
        </label>
        <input id={`code-${key}`} name="code" type="text" maxLength={12} defaultValue={b?.code ?? ""} style={{ textTransform: "uppercase" }} />
      </div>
      <div className="field">
        <label htmlFor={`manager-${key}`}>{tr("Branch manager")}</label>
        <select id={`manager-${key}`} name="manager_id" defaultValue={b?.manager_id ?? ""}>
          <option value="">{tr("Not set")}</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {names.get(m.user_id) ?? "—"}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`phone-${key}`}>{tr("Phone")}</label>
        <input id={`phone-${key}`} name="phone" type="tel" maxLength={40} defaultValue={b?.phone ?? ""} />
      </div>
      <div className="field" style={{ gridColumn: "1 / -1" }}>
        <label htmlFor={`address-${key}`}>{tr("Address")}</label>
        <input id={`address-${key}`} name="address" type="text" maxLength={300} defaultValue={b?.address ?? ""} />
      </div>
    </div>
  );
}

export default async function BranchesPage({ searchParams }: { searchParams: SearchParams }) {
  await primeLang();
  const notice = await readNotice(searchParams);
  const { supabase, company, role } = await getAppContext();
  const { data, error } = await supabase.from("branches").select("id, name, code, address, phone, manager_id, active").eq("company_id", company.id).order("name");
  if (isMissingTable(error)) return <NotReady title="Branches" />;
  if (error) throw new Error(error.message);
  const branches = (data ?? []) as Branch[];
  const manage = can(role, "manageBranches");
  const [{ data: memberData }, { data: storeData }] = await Promise.all([
    supabase.from("memberships").select("id, user_id, role, branch_id").eq("company_id", company.id).eq("active", true).order("created_at"),
    supabase.from("warehouses").select("id, code, name, active, branch_id").eq("company_id", company.id).order("name"),
  ]);
  const members = (memberData ?? []) as Member[];
  const stores = (storeData ?? []) as Store[];
  const names = await namesFor(supabase, [...members.map((m) => m.user_id), ...branches.map((b) => b.manager_id)]);
  const count = (list: { branch_id: string | null }[], id: string | null) => list.filter((x) => x.branch_id === id).length;
  const select = (name: string, value: string | null) => (
    <>
      <input type="hidden" name={`was:${name}`} value={value ?? ""} />
      <select name={name} defaultValue={value ?? ""} aria-label={tr("Branch")} disabled={!manage}>
        <option value="">{tr("No branch")}</option>
        {branches
          .filter((b) => b.active || b.id === value)
          .map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
      </select>
    </>
  );

  return (
    <>
      <div className="page-head">
        <h1>{tr("Branches")}</h1>
        {can(role, "planFinance") && branches.length > 0 && (
          <Link href="/head-office" className="btn btn-small">
            {tr("Head-office figures")}
          </Link>
        )}
      </div>
      <p className="muted small">
        {tr("Branches or business units, each with its own stores and team. Quotations, invoices, purchase orders and expenses go to the branch of the person who makes them.")}
      </p>
      <Notice {...notice} />

      {branches.length === 0 ? (
        <p className="card muted">{tr("No branches yet. With one location you do not need any.")}</p>
      ) : (
        <ul className="list card">
          {branches.map((b) => (
            <li key={b.id}>
              <div className="line-head">
                <div>
                  <strong>{b.name}</strong> {b.code && <span className="muted small">· {b.code}</span>}
                  {!b.active && <span className="badge"> {tr("Closed")}</span>}
                  <div className="muted small">
                    {b.manager_id && names.get(b.manager_id) && `${tr("Manager")}: ${names.get(b.manager_id)} · `}
                    {count(stores, b.id)} {tr("stores")} · {count(members, b.id)} {tr("people")}
                    {b.address && ` · ${b.address}`}
                    {b.phone && ` · ${b.phone}`}
                  </div>
                </div>
              </div>
              {manage && (
                <details>
                  <summary className="small">{tr("Change")}</summary>
                  <form action={saveBranch} style={{ marginTop: 8 }}>
                    <input type="hidden" name="id" value={b.id} />
                    <BranchFields b={b} members={members} names={names} />
                    <div className="field">
                      <label htmlFor={`active-${b.id}`}>{tr("Status")}</label>
                      <select id={`active-${b.id}`} name="active" defaultValue={b.active ? "yes" : "no"}>
                        <option value="yes">{tr("Open")}</option>
                        <option value="no">{tr("Closed")}</option>
                      </select>
                    </div>
                    <SubmitButton className="btn btn-small">{tr("Save")}</SubmitButton>
                  </form>
                  <form action={removeBranch} style={{ marginTop: 8 }}>
                    <input type="hidden" name="id" value={b.id} />
                    <SubmitButton className="btn btn-small btn-danger" pendingText="…">
                      {tr("Remove branch")}
                    </SubmitButton>
                    <span className="hint"> {tr("Only possible while nothing is in it.")}</span>
                  </form>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}

      {manage && (
        <details className="card" open={branches.length === 0}>
          <summary>
            <strong>{tr("+ Branch")}</strong>
          </summary>
          <form action={createBranch} style={{ marginTop: 12 }}>
            <BranchFields members={members} names={names} />
            <SubmitButton>{tr("Add branch")}</SubmitButton>
          </form>
        </details>
      )}

      {branches.length > 0 && (
        <form action={assignBranches}>
          <section className="card">
            <h2>{tr("Stores")}</h2>
            <ul className="list">
              {stores.map((s) => (
                <li key={s.id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span>
                    {s.name} <span className="muted small">· {s.code}</span>
                    {!s.active && <span className="muted small"> · {tr("Closed")}</span>}
                  </span>
                  <span>{select(`store:${s.id}`, s.branch_id)}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card">
            <h2>{tr("People")}</h2>
            <ul className="list">
              {members.map((m) => (
                <li key={m.id} className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
                  <span>
                    {names.get(m.user_id) ?? "—"} <span className="muted small">· {tr(ROLE_LABELS[m.role])}</span>
                  </span>
                  <span>{select(`member:${m.id}`, m.branch_id)}</span>
                </li>
              ))}
            </ul>
            <p className="hint">{tr("People with no branch work for the whole company (head office). What they make has no branch until management moves it.")}</p>
          </section>
          {manage && <SubmitButton>{tr("Save stores and people")}</SubmitButton>}
        </form>
      )}
    </>
  );
}
