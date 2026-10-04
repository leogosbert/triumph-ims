import { tr } from "@/lib/tr";
import { getThemePref } from "@/lib/theme";
import { setTheme } from "@/app/theme-actions";

/** Three-way switch: follow the phone, always light, always dark. */
export async function ThemePicker() {
  const pref = await getThemePref();
  const options = [
    { value: "auto", label: tr("Auto") },
    { value: "light", label: tr("Light") },
    { value: "dark", label: tr("Dark") },
  ];
  return (
    <form action={setTheme} className="seg" aria-label={tr("Appearance")}>
      {options.map((o) => (
        <button key={o.value} type="submit" name="theme" value={o.value} aria-pressed={pref === o.value}>
          {o.label}
        </button>
      ))}
    </form>
  );
}
