import type { Playbook } from "./types";
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
import { MINING_SERVICES } from "./mining-services";

export type { Playbook, PlaybookChapter, PlaybookExample, PlaybookScenario, PlaybookStep, Tone } from "./types";

/** In the order they are shown on /playbooks. */
export const PLAYBOOKS: Playbook[] = [SETUP, GOODS_BUSINESS, SERVICES_BUSINESS, GOODS_AND_SERVICES, MINING_SERVICES, ORDER_TO_CASH, ANALYTICS, GETTING_PAID, STOCK, ROUTINES, SECURITY, ENTERPRISE, CONNECT];

export function findPlaybook(id: string): Playbook | null {
  return PLAYBOOKS.find((p) => p.id === id) ?? null;
}

export function stepCount(p: Playbook): number {
  return p.chapters.reduce((n, c) => n + c.steps.length, 0);
}
export function scenarioCount(p: Playbook): number {
  return p.chapters.reduce((n, c) => n + c.steps.reduce((m, s) => m + (s.scenarios?.length ?? 0), 0), 0);
}
