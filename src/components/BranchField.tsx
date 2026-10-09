import { tr } from "@/lib/tr";
import { SubmitButton } from "@/components/SubmitButton";
import type { Branch, BranchDoc } from "@/lib/branches";
import { moveToBranch } from "@/app/(app)/branches/actions";

/**
 * The branch a document belongs to. Management can move it to another branch.
 * Shows nothing when the company has no branches.
 */
export function BranchField({ kind, id, branchId, branches, canMove }: { kind: BranchDoc; id: string; branchId: string | null; branches: Branch[]; canMove: boolean }) {
  if (branches.length === 0) return null;
  const current = branches.find((b) => b.id === branchId);
  if (!canMove) {
    return (
      <p className="small muted">
        {tr("Branch")}: {current?.name ?? tr("No branch")}
      </p>
    );
  }
  return (
    <form action={moveToBranch} className="row small" style={{ alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={id} />
      <label htmlFor={`branch-${id}`} className="muted">
        {tr("Branch")}
      </label>
      <select id={`branch-${id}`} name="branch_id" defaultValue={branchId ?? ""} style={{ width: "auto" }}>
        <option value="">{tr("No branch")}</option>
        {branches
          .filter((b) => b.active || b.id === branchId)
          .map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
      </select>
      <SubmitButton className="btn btn-small" pendingText="…">
        {tr("Move")}
      </SubmitButton>
    </form>
  );
}
