import { tr } from "@/lib/tr";
import Link from "next/link";
import type { Kpi, MonthBar, NamedValue, Tower } from "@/lib/dashboard";
import { Icon } from "@/components/Icon";
import { AGING } from "@/lib/finance";
import type { Dict } from "@/lib/i18n";

/** Short money for charts: 1.2M, 850K. */
function short(v: number) {
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${Math.round(v / 1e3)}K`;
  return String(Math.round(v));
}

export function ControlTower({ tower, t }: { tower: Tower; t: Dict }) {
  const sections: { key: keyof Tower; title: string; tone: string }[] = [
    { key: "critical", title: t["tower.critical"], tone: "bad" },
    { key: "attention", title: t["tower.attention"], tone: "warn" },
    { key: "normal", title: t["tower.normal"], tone: "info" },
  ];
  const empty = !tower.critical.length && !tower.attention.length && !tower.normal.length;
  return (
    <section className="tower-card">
      <h2>{t["home.tower"]}</h2>
      {empty && <p className="small muted">{t["home.allClear"]}</p>}
      {sections
        .filter((s) => tower[s.key].length > 0)
        .map((s) => {
          const items = tower[s.key];
          const total = items.reduce((a, i) => a + i.count, 0);
          return (
            <details key={s.key} className={`tower-row tone-${s.tone}`} open={s.key === "critical"}>
              <summary>
                <span className="tower-n num">{total}</span>
                <span className="tower-text">
                  <strong>{tr(String(s.title ?? ""))}</strong>
                  <span>
                    {items
                      .slice(0, 2)
                      .map((i) => `${i.count} ${i.label}`)
                      .join(" · ")}
                    {items.length > 2 ? " …" : ""}
                  </span>
                </span>
                <span className="tower-chev" aria-hidden="true">
                  <Icon name="chevron" size={18} strokeWidth={2} />
                </span>
              </summary>
              <ul>
                {items.map((i) => (
                  <li key={i.label}>
                    <Link href={i.href}>
                      <strong className="num">{i.count}</strong> {tr(String(i.label ?? ""))}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          );
        })}
    </section>
  );
}

export function KpiGrid({ kpis, currency }: { kpis: Kpi[]; currency: string }) {
  if (!kpis.length) return null;
  return (
    <div className="stat-grid">
      {kpis.map((k) => {
        const body = (
          <>
            <div className="n num">{k.money ? `${currency} ${short(k.value)}` : `${k.value.toLocaleString("en-GB")}${k.suffix ?? ""}`}</div>
            <div className="l">{tr(String(k.label ?? ""))}</div>
          </>
        );
        return k.href ? (
          <Link key={k.label} href={k.href} className={`stat ${k.alert ? "alert" : ""}`}>
            {body}
          </Link>
        ) : (
          <div key={k.label} className="stat">
            {body}
          </div>
        );
      })}
    </div>
  );
}

/** Sales and gross profit, last 6 months. */
export function SalesChart({ months, currency, t }: { months: MonthBar[]; currency: string; t: Dict }) {
  const max = Math.max(1, ...months.map((m) => Math.max(m.sales, m.profit)));
  const W = 320;
  const H = 150;
  const slot = W / months.length;
  const bw = slot * 0.32;
  const y = (v: number) => H - 20 - (Math.max(0, v) / max) * (H - 40);
  return (
    <section className="card">
      <h2>{t["c.salesProfit"]}</h2>
      <p className="small muted">
        {t["c.last6"]} · {currency}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={tr("Sales and gross profit by month")}>
        <line x1="0" x2={W} y1={H - 20} y2={H - 20} stroke="var(--line)" />
        {months.map((m, i) => {
          const x = i * slot + slot / 2;
          return (
            <g key={m.month}>
              <rect x={x - bw - 1} y={y(m.sales)} width={bw} height={H - 20 - y(m.sales)} fill="var(--brand)" rx="2">
                <title>{`${m.label}: sales ${short(m.sales)}`}</title>
              </rect>
              <rect x={x + 1} y={y(m.profit)} width={bw} height={H - 20 - y(m.profit)} fill="#14b8a6" rx="2">
                <title>{`${m.label}: gross profit ${short(m.profit)}`}</title>
              </rect>
              {m.sales > 0 && (
                <text x={x - bw / 2 - 1} y={y(m.sales) - 3} textAnchor="middle" fontSize="8" fill="var(--muted)">
                  {short(m.sales)}
                </text>
              )}
              <text x={x} y={H - 6} textAnchor="middle" fontSize="10" fill="var(--muted)">
                {tr(String(m.label ?? ""))}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="small legend">
        <span className="key" style={{ background: "var(--brand)" }} /> {t["c.sales"]} <span className="key" style={{ background: "#14b8a6" }} /> {t["c.profit"]}
      </p>
    </section>
  );
}

export function BarList({ title, sub, rows, currency, href }: { title: string; sub?: string; rows: NamedValue[]; currency: string; href?: string }) {
  if (!rows.length) return null;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <section className="card">
      <h2>{href ? <Link href={href}>{title}</Link> : title}</h2>
      {sub && <p className="small muted">{sub}</p>}
      <ul className="barlist">
        {rows.map((r) => (
          <li key={r.label}>
            <div className="row small">
              <span>{tr(String(r.label ?? ""))}</span>
              <span>
                {currency} {short(r.value)} {total > 0 && <span className="muted">· {Math.round((r.value / total) * 100)}%</span>}
              </span>
            </div>
            <div className="bar">
              <span style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function AgingChart({ aging, currency, title }: { aging: number[]; currency: string; title: string }) {
  if (aging.every((v) => v === 0)) return null;
  return <BarList title={title} rows={AGING.map((label, i) => ({ label, value: aging[i] }))} currency={currency} href="/receivables" />;
}
