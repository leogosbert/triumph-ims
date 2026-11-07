import Link from "next/link";
import type { Kpi } from "@/lib/dashboard";
import { MoneyFig } from "@/components/MoneyFig";
import { Sparkline, TrendArrow } from "@/components/Sparkline";

/**
 * One home figure, as a banner chip ("hero") or a Key figures tile ("stat"). No hooks: the caller
 * passes tr. The number sits in .money-amt / .kpi-val so CountUp can move it without touching the rest.
 */
export function KpiValue({ k, currency }: { k: Kpi; currency: string }) {
  return k.money ? (
    <MoneyFig value={k.value} currency={currency} short />
  ) : (
    <>
      <span className="kpi-val">{k.value.toLocaleString("en-GB")}</span>
      {k.suffix ?? ""}
    </>
  );
}

function Trend({ k, tr }: { k: Kpi; tr: (s: string) => string }) {
  if (!k.trend && (k.change === null || k.change === undefined)) return null;
  const spark = k.trend ? <Sparkline values={k.trend} label={`${tr(k.label)}: ${tr("last 6 months")}`} /> : null;
  const arrow = <TrendArrow change={k.change} tr={tr} />;
  return (
    <span className="kpi-trend">
      {spark}
      {arrow}
    </span>
  );
}

export function KpiTile({ k, currency, variant, tr }: { k: Kpi; currency: string; variant: "hero" | "stat"; tr: (s: string) => string }) {
  if (variant === "hero") {
    return (
      <Link href={k.href ?? "/"} className="kpi-hero">
        <span className="num">
          <KpiValue k={k} currency={currency} />
        </span>
        <Trend k={k} tr={tr} />
        <span className="kpi-label">{tr(k.label)}</span>
      </Link>
    );
  }
  const body = (
    <>
      <div className="n num">
        <KpiValue k={k} currency={currency} />
      </div>
      <Trend k={k} tr={tr} />
      <div className="l">{tr(k.label)}</div>
    </>
  );
  return k.href ? (
    <Link href={k.href} className={`stat${k.alert ? " alert" : ""}`}>
      {body}
    </Link>
  ) : (
    <div className="stat">{body}</div>
  );
}
