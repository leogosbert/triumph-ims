import type { Playbook, PlaybookStep } from "./types";
import { SETUP } from "./setup";
import { GOODS_BUSINESS } from "./goods-business";
import { SERVICES_BUSINESS } from "./services-business";
import { GOODS_AND_SERVICES } from "./goods-and-services";
import { ORDER_TO_CASH } from "./order-to-cash";
import { ANALYTICS } from "./analytics";
import { GETTING_PAID } from "./getting-paid";
import { STOCK } from "./stock";
import { ROUTINES } from "./routines";
import { SECURITY } from "./security";
import { CONNECT } from "./connect";
import { ENTERPRISE } from "./enterprise";
import { SW_SETUP } from "./sw/setup";
import { SW_GOODS_BUSINESS } from "./sw/goods-business";
import { SW_SERVICES_BUSINESS } from "./sw/services-business";
import { SW_GOODS_AND_SERVICES } from "./sw/goods-and-services";
import { SW_ORDER_TO_CASH } from "./sw/order-to-cash";
import { SW_ANALYTICS } from "./sw/analytics";
import { SW_GETTING_PAID } from "./sw/getting-paid";
import { SW_STOCK } from "./sw/stock";
import { SW_ROUTINES } from "./sw/routines";
import { SW_SECURITY } from "./sw/security";
import { SW_CONNECT } from "./sw/connect";
import { SW_ENTERPRISE } from "./sw/enterprise";

export type { Playbook, PlaybookChapter, PlaybookExample, PlaybookScenario, PlaybookStep, Tone } from "./types";

/** In the order they are shown on /playbooks. */
export const PLAYBOOKS: Playbook[] = [SETUP, GOODS_BUSINESS, SERVICES_BUSINESS, GOODS_AND_SERVICES, ORDER_TO_CASH, ANALYTICS, GETTING_PAID, STOCK, ROUTINES, SECURITY, ENTERPRISE, CONNECT];

export function findPlaybook(id: string): Playbook | null {
  return PLAYBOOKS.find((p) => p.id === id) ?? null;
}

/**
 * Kiswahili for the playbooks. Kept apart from src/lib/sw.ts so the long texts are not sent with
 * every screen: the server translates a playbook before it reaches the phone (and for the PDF).
 */
const SW_PB: Record<string, string> = {
  ...SW_SETUP,
  ...SW_GOODS_BUSINESS,
  ...SW_SERVICES_BUSINESS,
  ...SW_GOODS_AND_SERVICES,
  ...SW_ORDER_TO_CASH,
  ...SW_ANALYTICS,
  ...SW_GETTING_PAID,
  ...SW_STOCK,
  ...SW_ROUTINES,
  ...SW_SECURITY,
  ...SW_CONNECT,
  ...SW_ENTERPRISE,
};

/** The playbook in the chosen language (text without a translation stays in English). */
export function translatePlaybook(p: Playbook, lang: "en" | "sw", fallback: (s: string) => string): Playbook {
  if (lang !== "sw") return p;
  const t = (s: string) => SW_PB[s] ?? fallback(s);
  const step = (s: PlaybookStep): PlaybookStep => ({
    ...s,
    title: t(s.title),
    body: t(s.body),
    do: s.do?.map(t),
    where: s.where?.map(t),
    who: s.who ? t(s.who) : undefined,
    tip: s.tip ? t(s.tip) : undefined,
    example: s.example
      ? {
          ...s.example,
          kind: t(s.example.kind),
          title: t(s.example.title),
          stamp: s.example.stamp ? t(s.example.stamp) : undefined,
          lines: s.example.lines.map(([k, v]) => [t(k), t(v)] as [string, string]),
        }
      : undefined,
    scenarios: s.scenarios?.map((x) => ({ ...x, title: t(x.title), problem: t(x.problem), fix: x.fix.map(t) })),
  });
  return {
    ...p,
    title: t(p.title),
    tagline: t(p.tagline),
    audience: t(p.audience),
    chapters: p.chapters.map((c) => ({ ...c, title: t(c.title), intro: t(c.intro), steps: c.steps.map(step) })),
  };
}

export function stepCount(p: Playbook): number {
  return p.chapters.reduce((n, c) => n + c.steps.length, 0);
}
export function scenarioCount(p: Playbook): number {
  return p.chapters.reduce((n, c) => n + c.steps.reduce((m, s) => m + (s.scenarios?.length ?? 0), 0), 0);
}
