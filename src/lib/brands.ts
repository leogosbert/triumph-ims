/**
 * Customer brands for the installed app. LeMoSp (by LeMo Tech Solutions) is the technology; a
 * company can have its own name and icon on the phone and laptop home screen instead of LeMoSp's.
 *
 * The brand is picked by company id. The app shell remembers it in the `brand` cookie (not
 * sensitive: only the brand key), so the install details and the sign-in page can show it before
 * anyone is signed in. Add a company here with its icons in public/brands/<key>/.
 */
export type Brand = {
  key: string;
  /** Full name on the home screen when there is room; short name under the icon. */
  name: string;
  shortName: string;
  description: string;
  themeColor: string;
  /** Logo for dark backgrounds (sign-in page). */
  logoOnDark: string;
  companyIds: string[];
};

export const BRANDS: Brand[] = [
  {
    key: "triumph",
    name: "TRIUMPH General Suppliers",
    shortName: "TRIUMPH",
    description: "TRIUMPH General Suppliers: sales, procurement, stock, delivery and finance. Powered by LeMoSp, a LeMo Tech Solutions product.",
    themeColor: "#1c4c9b",
    logoOnDark: "/brands/triumph/logo-white.svg",
    companyIds: ["2ad86152-e1a0-411c-96ec-ddfb0439b5c5"],
  },
];

export const BRAND_COOKIE = "brand";

export function brandByKey(key: string | null | undefined): Brand | null {
  return BRANDS.find((b) => b.key === key) ?? null;
}

export function brandForCompany(companyId: string | null | undefined): Brand | null {
  return (companyId && BRANDS.find((b) => b.companyIds.includes(companyId))) || null;
}

/** Icons for the install details (web app manifest). */
export function brandIcons(b: Brand) {
  const dir = `/brands/${b.key}`;
  return [
    { src: `${dir}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `${dir}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: `${dir}/icon-maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ];
}
