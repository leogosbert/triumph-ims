import { NAV_PATHS } from "@/lib/nav";

/**
 * Sections of the app, as the Glass style sees them: each has its own accent shade (src/app/glass.css,
 * html[data-section=…]) and its own photos behind the screen (Background → Photos).
 */
export const SECTIONS = [
  "home",
  "sales",
  "purchasing",
  "stock",
  "deliveries",
  "services",
  "administration",
  "finance",
  "reports",
  "settings",
  "compliance",
  "help",
  "login",
] as const;
export type Section = (typeof SECTIONS)[number];

/** Which section a screen belongs to. Screens not listed (More, notifications, search…) count as home. */
const SECTION_PATHS: [Section, readonly string[]][] = [
  ["sales", [...NAV_PATHS.sales, ...NAV_PATHS.clients]],
  ["purchasing", NAV_PATHS.purchasing],
  ["stock", [...NAV_PATHS.stock, ...NAV_PATHS.products]],
  ["deliveries", [...NAV_PATHS.deliveries, "/driver"]],
  ["services", NAV_PATHS.services],
  ["administration", NAV_PATHS.admin],
  ["finance", NAV_PATHS.finance],
  ["reports", [...NAV_PATHS.reports, "/insights", "/growth"]],
  ["settings", ["/settings", "/account", "/branches", "/integrations", "/import", "/admin"]],
  ["compliance", ["/compliance"]],
  ["help", ["/help", "/guide", "/suggestions", "/playbooks"]],
  ["login", ["/login", "/forgot-password", "/two-step"]],
];

export function sectionFor(pathname: string): Section {
  for (const [section, paths] of SECTION_PATHS) {
    if (paths.some((p) => p !== "/" && (pathname === p || pathname.startsWith(`${p}/`)))) return section;
  }
  return "home";
}

/**
 * Background photos.
 *
 * Today every company gets the built-in set below (free Pexels photos, the same ones the company
 * website uses: industry, mining, oil & gas, warehouses, trucks). The shape is ready for a later
 * "your own photos" setting: a company would upload pictures to its storage and save a
 * CompanyScenes value (photos per section, plus how to blend them); PhotoScene takes it as a prop
 * and falls back to these for any section left empty. No upload screen yet.
 */
export type ScenePhoto = {
  url: string;
  /** CSS background-position, to keep the interesting part in view (default "center"). */
  focus?: string;
};

export type SceneBlend = {
  /** How strongly the photo shows through, 0–1 (default: 0.2 light / 0.3 dark, from glass.css). */
  strength?: number;
  /** "brand": tinted with the section colours (default); "neutral": plain dark/light veil; "none": photo only. */
  wash?: "brand" | "neutral" | "none";
  /** Soften the photo (px of blur, default 1). */
  blur?: number;
};

export type CompanyScenes = {
  photos: Partial<Record<Section, ScenePhoto[]>>;
  blend?: SceneBlend;
};

const PX = (id: number, focus?: string): ScenePhoto => ({ url: `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg`, focus });

const P = {
  drums: PX(38150961),
  containers: PX(13572281),
  bearings: PX(39994422),
  gears: PX(39315863),
  spares: PX(7568421),
  ppe: PX(33914927),
  helmet: PX(34965713),
  mining: PX(28442180),
  mine2: PX(15071423),
  cement: PX(18468425),
  cementNight: PX(29590119),
  refinery: PX(38343896),
  tanks: PX(31403876),
  warehouse: PX(4487383),
  shelves: PX(30341205),
  truck: PX(18885403),
  trailer: PX(5410923),
  handshake: PX(33175650),
  worker: PX(14875937),
  engineer: PX(11174191),
  mechanic: PX(28153670),
  chemicals: PX(2786527),
};

export const DEFAULT_SCENES: CompanyScenes = {
  photos: {
    home: [P.refinery, P.mining, P.cementNight],
    sales: [P.handshake, P.containers],
    purchasing: [P.containers, P.drums],
    stock: [P.warehouse, P.shelves, P.spares],
    deliveries: [P.truck, P.trailer],
    services: [P.mechanic, P.engineer, P.gears],
    administration: [P.worker, P.helmet],
    finance: [P.cementNight, P.tanks],
    reports: [P.tanks, P.refinery],
    settings: [P.gears, P.bearings],
    compliance: [P.ppe, P.helmet],
    help: [P.engineer, P.worker],
    login: [P.mining, P.refinery, P.warehouse],
  },
  blend: { wash: "brand" },
};

/** The photos for a section: the company's own first, then the built-in set, then home. */
export function photosFor(section: Section, own?: CompanyScenes | null): ScenePhoto[] {
  return own?.photos[section]?.length ? own.photos[section]! : (DEFAULT_SCENES.photos[section] ?? DEFAULT_SCENES.photos.home ?? []);
}

/** A sensibly sized copy of a photo (Pexels resizes on request; other addresses are used as they are). */
export function photoSrc(url: string, width: number): string {
  if (!url.startsWith("https://images.pexels.com/")) return url;
  return `${url.split("?")[0]}?auto=compress&cs=tinysrgb&w=${width}`;
}
