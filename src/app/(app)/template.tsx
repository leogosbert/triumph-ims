/**
 * Mounted afresh on every screen change (unlike the layout), so each screen comes in with one quick
 * fade and a small rise (polish.css, .app-page: 160 ms, nothing staggered). LeMoSp ADMIN keeps its own.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="app-page">{children}</div>;
}
