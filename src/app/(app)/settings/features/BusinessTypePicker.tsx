import { tr } from "@/lib/tr";
import { SubmitButton } from "@/components/SubmitButton";
import { BUSINESS_TYPES } from "@/lib/services";
import { setBusinessType } from "./actions";

/** "What do you sell?": goods, services or both. */
export function BusinessTypePicker({ current, back }: { current: string; back?: string }) {
  return (
    <form action={setBusinessType}>
      {back && <input type="hidden" name="back" value={back} />}
      <div className="sj-types">
        {Object.entries(BUSINESS_TYPES).map(([k, t]) => (
          <label key={k} className="sj-type">
            <input type="radio" name="business_type" value={k} defaultChecked={current === k} />
            <span>
              <strong>{tr(t.label)}</strong>
              <span className="small muted">{tr(t.hint)}</span>
            </span>
          </label>
        ))}
      </div>
      <SubmitButton className="btn btn-small" pendingText={tr("Saving…")}>
        {tr("Save what we sell")}
      </SubmitButton>
    </form>
  );
}
