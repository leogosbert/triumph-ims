import { tr } from "@/lib/tr";
import { BACKGROUNDS, getBackgroundPref } from "@/lib/background";
import { setBackground } from "@/app/theme-actions";

const LABELS: Record<(typeof BACKGROUNDS)[number], string> = {
  aurora: "Aurora",
  grid: "Grid",
  waves: "Waves",
  mountains: "Mountains",
  plain: "Plain",
};

/** Choose the picture behind the app, shown as small previews in the company's colours. */
export async function BackgroundPicker() {
  const pref = await getBackgroundPref();
  return (
    <form action={setBackground} className="bg-picker" aria-label={tr("Background")}>
      {BACKGROUNDS.map((b) => (
        <button key={b} type="submit" name="bg" value={b} aria-pressed={pref === b}>
          <span className={`bg-swatch s-${b}`} aria-hidden="true" />
          {tr(LABELS[b])}
        </button>
      ))}
    </form>
  );
}
