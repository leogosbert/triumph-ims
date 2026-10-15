/**
 * Mounted afresh on every screen change (unlike the layout), so each screen fades in and its
 * blocks follow one after another (polish.css, .app-page). LeMoSp ADMIN keeps its own entrance.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return <div className="app-page">{children}</div>;
}
