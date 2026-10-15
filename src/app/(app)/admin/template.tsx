/**
 * Mounted afresh on every admin page change (unlike the layout), so each page glides in and its
 * cards follow one after another (admin.css, .adm-page).
 */
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div className="adm-page">{children}</div>;
}
