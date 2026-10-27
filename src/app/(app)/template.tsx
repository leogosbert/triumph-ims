/**
 * Mounted afresh on every screen change (unlike the layout), so each screen comes in with one quick
 * fade and a small rise (polish.css, .app-page: 160 ms, nothing staggered). LeMoSp ADMIN keeps its own.
 *
 * There is deliberately no loading.tsx in (app) or (app)/admin: with one, a form that saves and comes
 * back to its own screen (?msg=…) often left the screen empty until a reload (Next.js 15). The top bar
 * (NavProgress) is the feedback while a screen loads.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="app-page">{children}</div>;
}
