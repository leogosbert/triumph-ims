/**
 * Playbooks (/playbooks): long, step-by-step guides with animated examples, real scenarios and a
 * downloadable PDF each. Content lives in one file per playbook next to this one; English is the key
 * and the pages show it through tr()/useTr().
 * Write in plain English for a Tanzanian business owner. Button and screen names must match the app
 * exactly (see src/lib/guide.ts). Amounts in TZS unless the example is about USD.
 */

export type Tone = "info" | "ok" | "warn" | "bad";

/** A sample record or screen that builds itself line by line, with a stamp at the end. */
export type PlaybookExample = {
  /** Kind of record or screen, e.g. "Quotation" or "Home". */
  kind: string;
  /** Its number or name, e.g. "QT-2026-0042" (not translated when it is a code). */
  title: string;
  /** Lines shown one after another: label, value. 2 to 6 lines. */
  lines: [string, string][];
  /** Index of a line to highlight. */
  mark?: number;
  /** Stamp that lands at the end, e.g. "Approved". */
  stamp?: string;
  tone: Tone;
};

/** "If this happens": a real situation and how to handle it with the app. */
export type PlaybookScenario = {
  title: string;
  /** What happened, one or two sentences. */
  problem: string;
  /** What to do, in order. */
  fix: string[];
  tone?: Tone;
};

export type PlaybookStep = {
  id: string;
  title: string;
  /** Why this step matters / what it is, 1 to 3 sentences. */
  body: string;
  /** Numbered actions in the app. */
  do?: string[];
  /** Where to find it (laptop side menu path), e.g. ["Sales", "Quotations"]. */
  where?: string[];
  /** In-app link, e.g. "/quotations". */
  href?: string;
  /** Who normally does it, e.g. "Management" or "Finance and Management". */
  who?: string;
  example?: PlaybookExample;
  scenarios?: PlaybookScenario[];
  tip?: string;
  /** Business sizes that have it by default. */
  scales?: "all" | "medium+" | "enterprise";
};

export type PlaybookChapter = { id: string; title: string; intro: string; steps: PlaybookStep[] };

export type Playbook = {
  id: string;
  title: string;
  /** One line on what you get from it. */
  tagline: string;
  /** Who it is for. */
  audience: string;
  /** Rough reading time in minutes. */
  minutes: number;
  /** Icon name from src/components/Icon.tsx. */
  icon: "settings" | "sales" | "report" | "cash" | "stock" | "lock" | "team" | "activity" | "purchasing" | "help";
  /** Accent colour for the cover. */
  color: string;
  chapters: PlaybookChapter[];
};
