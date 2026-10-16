import { featureForRoute } from "@/lib/features";
import type { Level } from "@/lib/levels";
import type { Playbook, PlaybookChapter, PlaybookStep } from "./types";

/**
 * Playbooks made for one company: its name in the examples, only the steps that fit its size and the
 * features it has switched on, and its own registration numbers where an example shows them.
 * The owner stays in control: the full playbook is one tap away (?full=1).
 */

export type PlaybookProfile = {
  name: string;
  level?: Level;
  businessType?: "goods" | "services" | "both";
  /** False before the feature switches exist (then only the size decides). */
  featuresReady: boolean;
  featureOn: (key?: string | null) => boolean;
  tin?: string | null;
  vrn?: string | null;
  registrationNo?: string | null;
  /** The company works for mines (its name says so), so the mining services playbook is recommended. */
  mining?: boolean;
};

export type TailorResult = {
  pb: Playbook;
  /** Steps kept, out of all the steps in the playbook. */
  kept: number;
  total: number;
  /** Steps left out because their feature is switched off for the company. */
  switchedOff: number;
  /** Steps left out because they are for larger businesses. */
  larger: number;
  /** True when almost nothing would be left, so the whole playbook is shown. */
  mostlyLarger: boolean;
};

/** The made-up company each playbook's examples are about; the reader's company takes its place. */
const SAMPLE_SELLERS = [
  "Pwani Cooling Services Ltd",
  "Kilimanjaro Supplies Ltd",
  "Kilimanjaro Supplies",
  "Kilimo Supplies Ltd",
  "Kilimo Supplies",
  "Maji Bora Ltd",
  "Madini Mining Services Ltd",
];

const LEVEL_NAMES: Record<Level, string> = { small: "Small", medium: "Medium", enterprise: "Enterprise" };

/** Replaces chapter intros that introduce the made-up company. */
export const TAILORED_INTRO =
  "The examples in this playbook use your company's name. The people, clients, items, amounts and situations in them are samples that show how it works.";

function fitsSize(step: PlaybookStep, level?: Level): boolean {
  if (!level || !step.scales || step.scales === "all") return true;
  if (step.scales === "medium+") return level !== "small";
  return level === "enterprise";
}

/** Keep, or the reason it is left out. */
function judge(step: PlaybookStep, p: PlaybookProfile): "keep" | "off" | "larger" {
  const feature = step.href ? featureForRoute(step.href) : undefined;
  // A feature the company has chosen decides, whatever the size: switched on means it applies.
  if (feature && p.featuresReady) return p.featureOn(feature) ? "keep" : "off";
  return fitsSize(step, p.level) ? "keep" : "larger";
}

/** Only the steps that fit the company (the text is still English, so translate afterwards). */
export function tailorPlaybook(pb: Playbook, p: PlaybookProfile, opts: { all?: boolean } = {}): TailorResult {
  let total = 0;
  let switchedOff = 0;
  let larger = 0;
  const chapters: PlaybookChapter[] = [];
  for (const c of pb.chapters) {
    const steps = c.steps.filter((s) => {
      total++;
      const v = judge(s, p);
      if (v === "off") switchedOff++;
      if (v === "larger") larger++;
      return opts.all || v === "keep";
    });
    if (steps.length) chapters.push({ ...c, intro: /\bOur example\b/.test(c.intro) ? TAILORED_INTRO : c.intro, steps: steps.map((s) => ownNumbers(s, p)) });
  }
  const kept = total - switchedOff - larger;
  if (opts.all) return { pb: { ...pb, chapters }, kept, total, switchedOff, larger, mostlyLarger: false };
  if (kept < 3) {
    // Nearly all of it is for a bigger set-up: show it whole, so the reader can see what is ahead.
    return { pb: withIntro(pb, p), kept: total, total, switchedOff: 0, larger: 0, mostlyLarger: true };
  }
  const minutes = Math.max(5, Math.round((pb.minutes * kept) / Math.max(total, 1)));
  return { pb: { ...pb, minutes, chapters }, kept, total, switchedOff, larger, mostlyLarger: false };
}

function withIntro(pb: Playbook, p: PlaybookProfile): Playbook {
  return {
    ...pb,
    chapters: pb.chapters.map((c) => ({ ...c, intro: /\bOur example\b/.test(c.intro) ? TAILORED_INTRO : c.intro, steps: c.steps.map((s) => ownNumbers(s, p)) })),
  };
}

/** The company's own registration numbers and level where an example shows them (before translation). */
function ownNumbers(s: PlaybookStep, p: PlaybookProfile): PlaybookStep {
  if (!s.example) return s;
  const own: Record<string, string | null | undefined> = {
    TIN: p.tin,
    VRN: p.vrn,
    "Registration number": p.registrationNo,
    "Business level": p.level ? LEVEL_NAMES[p.level] : null,
    Level: p.level ? LEVEL_NAMES[p.level] : null,
  };
  return { ...s, example: { ...s.example, lines: s.example.lines.map(([k, v]) => [k, own[k]?.trim() || v] as [string, string]) } };
}

/**
 * The company's name and numbers in the (already translated) text. Run after translation: the
 * Kiswahili keeps the same company names, so one pass covers both languages.
 */
export function nameTheCompany(pb: Playbook, companyName: string): Playbook {
  const name = companyName.trim();
  if (!name) return pb;
  const swap = (s: string) => SAMPLE_SELLERS.reduce((acc, sample) => acc.split(sample).join(name), s);
  const step = (s: PlaybookStep): PlaybookStep => ({
    ...s,
    title: swap(s.title),
    body: swap(s.body),
    do: s.do?.map(swap),
    tip: s.tip ? swap(s.tip) : undefined,
    example: s.example
      ? {
          ...s.example,
          title: swap(s.example.title),
          lines: s.example.lines.map(([k, v]) => [k, swap(v)] as [string, string]),
        }
      : undefined,
    scenarios: s.scenarios?.map((x) => ({ ...x, title: swap(x.title), problem: swap(x.problem), fix: x.fix.map(swap) })),
  });
  return { ...pb, chapters: pb.chapters.map((c) => ({ ...c, intro: swap(c.intro), steps: c.steps.map(step) })) };
}

/** Which playbooks suit the company best, for the list. */
export function recommendedFor(p: Pick<PlaybookProfile, "businessType" | "level" | "mining">): Set<string> {
  const ids = new Set(["setup"]);
  ids.add(p.businessType === "services" ? "services-business" : p.businessType === "both" ? "goods-and-services" : "goods-business");
  if (p.businessType !== "services") ids.add("order-to-cash");
  if (p.mining) ids.add("mining-services");
  ids.add("getting-paid");
  if (p.level === "enterprise") ids.add("enterprise");
  return ids;
}
