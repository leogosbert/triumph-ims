"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTr } from "@/lib/tr-client";

export type GuideViewTopic = {
  id: string;
  title: string;
  summary: string;
  phone: string;
  laptop: string;
  href: string | null;
  who: string;
  yours: boolean;
  off: boolean;
  steps: string[];
  tips: string[];
};
export type GuideViewSection = { id: string; title: string; intro: string; topics: GuideViewTopic[] };

/** The App guide: contents, search, "only what I can use", open/close all, and print. */
export function GuideView({ sections, company, roleLabel }: { sections: GuideViewSection[]; company: string; roleLabel: string }) {
  const t = useTr();
  const [q, setQ] = useState("");
  const [onlyMine, setOnlyMine] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const total = sections.reduce((n, s) => n + s.topics.length, 0);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return sections
      .map((s) => ({
        ...s,
        topics: s.topics.filter((tp) => {
          if (onlyMine && (!tp.yours || tp.off)) return false;
          if (!words.length) return true;
          const hay = [s.title, tp.title, tp.summary, tp.phone, tp.laptop, ...tp.steps, ...tp.tips].join(" ").toLowerCase();
          return words.every((w) => hay.includes(w));
        }),
      }))
      .filter((s) => s.topics.length > 0);
  }, [sections, q, onlyMine]);

  const searching = q.trim().length > 0;
  const isOpen = (id: string) => searching || open.has(id);
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const all = sections.flatMap((s) => s.topics.map((tp) => tp.id));
  const allOpen = all.every((id) => open.has(id));

  return (
    <div className="guide report-print">
      <div className="rep-head">
        <p className="rep-company">{company}</p>
        <h1 style={{ margin: "2px 0 6px" }}>{t("App guide")}</h1>
        <p className="muted small">
          {t("Every function of LeMoSp: what it does, where to find it on a phone and on a laptop, and how to use it step by step.")}{" "}
          {total} {t("topics")}.
        </p>
      </div>

      <div className="card guide-tools no-print">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search the guide, e.g. invoice, stock, password")} aria-label={t("Search the guide")} />
        <div className="guide-tool-row">
          <label className="check small">
            <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} /> {t("Only what I can use")} ({roleLabel})
          </label>
          <span className="rep-buttons">
            <button type="button" className="btn btn-small" onClick={() => setOpen(allOpen ? new Set() : new Set(all))}>
              {allOpen ? t("Close all") : t("Open all")}
            </button>
            <button
              type="button"
              className="btn btn-small"
              onClick={() => {
                setOpen(new Set(all));
                setTimeout(() => window.print(), 150);
              }}
            >
              🖨 {t("Print")}
            </button>
          </span>
        </div>
        {!searching && (
          <nav className="guide-toc" aria-label={t("Contents")}>
            {shown.map((s) => (
              <a key={s.id} href={`#${s.id}`} className="chip">
                {s.title}
              </a>
            ))}
          </nav>
        )}
      </div>

      {shown.length === 0 && <p className="muted">{t("Nothing in the guide matches your search.")}</p>}

      {shown.map((s, si) => (
        <section key={s.id} id={s.id} className="guide-section">
          <h2>
            {si + 1}. {s.title}
          </h2>
          <p className="muted small">{s.intro}</p>
          {s.topics.map((tp) => (
            <article key={tp.id} id={tp.id} className={`card guide-topic${isOpen(tp.id) ? " open" : ""}`}>
              <button type="button" className="guide-topic-head" aria-expanded={isOpen(tp.id)} onClick={() => toggle(tp.id)}>
                <span>
                  <strong>{tp.title}</strong>
                  <span className="small muted guide-summary">{tp.summary}</span>
                </span>
                <span className="guide-chev no-print" aria-hidden>
                  {isOpen(tp.id) ? "−" : "+"}
                </span>
              </button>
              {isOpen(tp.id) && (
                <div className="guide-body">
                  <dl className="guide-where">
                    <dt>📱 {t("On a phone")}</dt>
                    <dd>{tp.phone}</dd>
                    <dt>💻 {t("On a laptop")}</dt>
                    <dd>{tp.laptop}</dd>
                    <dt>👤 {t("Who can use it")}</dt>
                    <dd>
                      {tp.who}
                      {!tp.yours && <span className="badge tone-off" style={{ marginLeft: 6 }}>{t("Not for your role")}</span>}
                      {tp.off && <span className="badge tone-warn" style={{ marginLeft: 6 }}>{t("Switched off for your company")}</span>}
                    </dd>
                  </dl>
                  <ol className="guide-steps">
                    {tp.steps.map((st, i) => (
                      <li key={i}>{st}</li>
                    ))}
                  </ol>
                  {tp.tips.map((tip, i) => (
                    <p key={i} className="small guide-tip">
                      💡 {tip}
                    </p>
                  ))}
                  {tp.href && tp.yours && !tp.off && (
                    <p className="no-print" style={{ margin: "8px 0 0" }}>
                      <Link href={tp.href} className="btn btn-small btn-primary">
                        {t("Open")} {tp.title} →
                      </Link>
                    </p>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}
