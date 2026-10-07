"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useTr } from "@/lib/tr-client";

/**
 * Reports a person saved with their dates, filters and columns. Kept on this phone or computer
 * only (browser storage): it is a shortcut, the figures are worked out again each time.
 */
type Saved = { name: string; href: string; at: string };

const keyFor = (company: string) => `lemosp.savedReports.${company}`;

function read(company: string): Saved[] {
  try {
    const v = JSON.parse(localStorage.getItem(keyFor(company)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x?.name === "string" && typeof x?.href === "string" && x.href.startsWith("/reports/")) : [];
  } catch {
    return [];
  }
}

function write(company: string, list: Saved[]) {
  try {
    localStorage.setItem(keyFor(company), JSON.stringify(list.slice(0, 30)));
  } catch {
    /* storage blocked: nothing to keep */
  }
}

export function SavedReports({ company }: { company: string }) {
  const t = useTr();
  const [list, setList] = useState<Saved[]>([]);
  useEffect(() => setList(read(company)), [company]);
  if (list.length === 0) return null;
  return (
    <section className="card">
      <h2>{t("My saved reports")}</h2>
      <ul className="list">
        {list.map((s, i) => (
          <li key={`${s.href}-${i}`} className="row">
            <Link href={s.href}>{s.name}</Link>
            <button
              type="button"
              className="btn btn-small"
              aria-label={`${t("Remove")} ${s.name}`}
              onClick={() => {
                const next = list.filter((_, k) => k !== i);
                write(company, next);
                setList(next);
              }}
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
      <p className="small muted" style={{ marginBottom: 0 }}>
        {t("Saved on this device only. Ready-made periods such as This month move with the calendar.")}
      </p>
    </section>
  );
}

export function SaveReportButton({ company, href, suggested }: { company: string; href: string; suggested: string }) {
  const t = useTr();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(suggested);
  const [done, setDone] = useState(false);
  if (done) return <span className="small muted">✓ {t("Saved to your reports")}</span>;
  if (!open)
    return (
      <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>
        ☆ {t("Save")}
      </button>
    );
  return (
    <span className="rep-save">
      <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label={t("Name for this report")} />
      <button
        type="button"
        className="btn btn-small btn-primary"
        onClick={() => {
          const clean = name.trim() || suggested;
          write(company, [{ name: clean, href, at: new Date().toISOString() }, ...read(company).filter((s) => s.href !== href)]);
          setDone(true);
        }}
      >
        {t("Save")}
      </button>
    </span>
  );
}
