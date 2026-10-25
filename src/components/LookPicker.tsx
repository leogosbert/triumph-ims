import { tr } from "@/lib/tr";
import { getLookPref } from "@/lib/look-server";
import { setLook } from "@/app/theme-actions";

/** Glass (frosted panels, photos, folding sidebar) or Classic (the earlier look). Saved on this browser. */
export async function LookPicker() {
  const pref = await getLookPref();
  const options = [
    { value: "glass", label: tr("Glass") },
    { value: "classic", label: tr("Classic") },
  ];
  return (
    <form action={setLook} className="seg" aria-label={tr("Style")}>
      {options.map((o) => (
        <button key={o.value} type="submit" name="look" value={o.value} aria-pressed={pref === o.value}>
          {o.label}
        </button>
      ))}
    </form>
  );
}
