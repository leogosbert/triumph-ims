"use client";

import { useEffect, useRef, useState } from "react";
import { DemoScalePicker } from "@/components/DemoScalePicker";
import { SubmitButton } from "@/components/SubmitButton";
import { ACTIVITIES, LEVELS, LEVEL_ORDER, recommendLevel, type BusinessProfile, type Level } from "@/lib/levels";
import { useTr } from "@/lib/tr-client";

type Action = (form: FormData) => void | Promise<void>;

const NUMBER_QUESTIONS: { key: keyof BusinessProfile; label: string; hint?: string; money?: boolean }[] = [
  { key: "employees", label: "How many people work in the business?", hint: "Including you." },
  { key: "customers", label: "How many active customers do you have?" },
  { key: "suppliers", label: "How many suppliers do you buy from?" },
  { key: "products", label: "How many products or items (SKUs) do you sell?" },
  { key: "warehouses", label: "How many stores or warehouses keep stock?" },
  { key: "branches", label: "How many branches or offices?" },
  { key: "monthly_sales", label: "Average sales per month (TZS)", hint: "A rough figure is fine.", money: true },
  { key: "monthly_transactions", label: "About how many quotations, invoices and orders a month?" },
];

const YES_NO_QUESTIONS: { key: keyof BusinessProfile; label: string }[] = [
  { key: "imports", label: "Do you import goods?" },
  { key: "tenders", label: "Do you take part in tenders?" },
  { key: "corporate_clients", label: "Do you supply corporate clients (mines, factories, government…)?" },
  { key: "services", label: "Do you also sell services (installation, repairs, contracting)?" },
  { key: "credit", label: "Do customers buy on credit?" },
  { key: "approvals", label: "Do quotations or purchases need a manager's approval?" },
];

const STEPS = ["Levels", "Activities", "Your business", "Your level"];

function digits(v: string) {
  return v.replace(/[^\d]/g, "");
}

export function OnboardingWizard({
  companyName,
  initial,
  currentLevel,
  ready,
  finishAction,
  demoAction,
}: {
  companyName: string;
  initial: BusinessProfile;
  currentLevel: Level;
  /** False before the Stage 11 database update: the last step cannot be saved yet. */
  ready: boolean;
  finishAction: Action;
  demoAction: Action;
}) {
  const tr = useTr();
  const [step, setStep] = useState(0);
  const [activities, setActivities] = useState<string[]>(initial.activities ?? []);
  const startNumbers: Record<string, string> = {};
  for (const q of NUMBER_QUESTIONS) {
    const v = initial[q.key];
    startNumbers[q.key] = typeof v === "number" ? String(v) : "";
  }
  const startYesNo: Record<string, boolean | null> = {};
  for (const q of YES_NO_QUESTIONS) {
    const v = initial[q.key];
    startYesNo[q.key] = typeof v === "boolean" ? v : null;
  }
  const [numbers, setNumbers] = useState<Record<string, string>>(startNumbers);
  const [yesNo, setYesNo] = useState<Record<string, boolean | null>>(startYesNo);
  const [chosen, setChosen] = useState<Level | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // New step: back to the top, and screen readers hear the new heading.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    heading.current?.focus();
  }, [step]);

  const profile: BusinessProfile = { activities };
  for (const q of NUMBER_QUESTIONS) {
    if (numbers[q.key] !== "") (profile as Record<string, unknown>)[q.key] = Number(numbers[q.key]);
  }
  for (const q of YES_NO_QUESTIONS) {
    if (yesNo[q.key] !== null) (profile as Record<string, unknown>)[q.key] = yesNo[q.key];
  }
  if (activities.includes("importer") && yesNo.imports === null) profile.imports = true;
  if (activities.includes("service_provider") && yesNo.services === null) profile.services = true;
  const rec = recommendLevel(profile, tr);
  const level = chosen ?? rec.level;

  const toggleActivity = (k: string) =>
    setActivities((list) => (list.includes(k) ? list.filter((x) => x !== k) : [...list, k]));

  const titles = [
    "Three ways to run LeMoSp",
    "What does your business do?",
    "A few quick questions",
    "Your recommended starting level",
  ];

  return (
    <div className="onb">
      <div className="onb-progress" aria-label={tr("Progress")}>
        {STEPS.map((s, i) => (
          <span key={s} className={i <= step ? "done" : undefined} aria-current={i === step ? "step" : undefined}>
            <i>{i + 1}</i>
            <b>{tr(s)}</b>
          </span>
        ))}
      </div>

      <section className="onb-card" key={step}>
        <h1 ref={heading} tabIndex={-1}>
          {tr(titles[step])}
        </h1>

        {step === 0 && (
          <>
            <p>
              {tr("Welcome, {company}. LeMoSp grows with your business. Pick how simple or complete your workspace should be at the start.").replace(
                "{company}",
                companyName,
              )}
            </p>
            <div className="onb-levels">
              {LEVEL_ORDER.map((l) => (
                <div key={l} className={`lvl-card lvl-${l}`}>
                  <span className="lvl-card-top">
                    <strong>{tr(LEVELS[l].title)}</strong>
                  </span>
                  <span className="lvl-promise">{tr(LEVELS[l].promise)}</span>
                  <span className="lvl-for">{tr(LEVELS[l].forWho)}</span>
                  <ul>
                    {LEVELS[l].modules.map((m) => (
                      <li key={m}>{tr(m)}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <p className="onb-note">
              <strong>{tr("This is not a judgement of your company.")}</strong>{" "}
              {tr("The level only decides which tools you see first. You can change it at any time, and you never lose any data.")}
            </p>
            <div className="onb-demo">
              <strong>{tr("Want to look around first?")}</strong>
              <p className="small muted">
                {tr("Each demo opens a sample company next to yours, full of made-up data for that size of business, with a short guided tour. Leave the demo to come back here.")}
              </p>
              <DemoScalePicker action={demoAction} tone="light" />
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <p className="muted">{tr("Choose all that apply. Many suppliers do several of these.")}</p>
            <div className="onb-chips" role="group" aria-label={tr("Business activities")}>
              {ACTIVITIES.map((a) => (
                <button key={a.key} type="button" aria-pressed={activities.includes(a.key)} onClick={() => toggleActivity(a.key)}>
                  {activities.includes(a.key) ? "✓ " : ""}
                  {tr(a.label)}
                </button>
              ))}
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <p className="muted">{tr("Rough numbers are fine. Leave a box empty if you are not sure.")}</p>
            <div className="onb-grid">
              {NUMBER_QUESTIONS.map((q) => (
                <div className="field" key={q.key}>
                  <label htmlFor={`q-${q.key}`}>{tr(q.label)}</label>
                  <input
                    id={`q-${q.key}`}
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={q.money ? tr("e.g. 25,000,000") : "0"}
                    value={numbers[q.key] ? (q.money ? Number(numbers[q.key]).toLocaleString("en-GB") : numbers[q.key]) : ""}
                    onChange={(e) => {
                      const v = digits(e.target.value).slice(0, 15);
                      setNumbers((o) => ({ ...o, [q.key]: v }));
                    }}
                  />
                  {q.hint && <span className="hint">{tr(q.hint)}</span>}
                </div>
              ))}
            </div>
            <ul className="onb-yesno">
              {YES_NO_QUESTIONS.map((q) => (
                <li key={q.key}>
                  <span id={`yn-${q.key}`}>{tr(q.label)}</span>
                  <span className="seg" role="group" aria-labelledby={`yn-${q.key}`}>
                    <button type="button" aria-pressed={yesNo[q.key] === true} onClick={() => setYesNo((o) => ({ ...o, [q.key]: true }))}>
                      {tr("Yes")}
                    </button>
                    <button type="button" aria-pressed={yesNo[q.key] === false} onClick={() => setYesNo((o) => ({ ...o, [q.key]: false }))}>
                      {tr("No")}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}

        {step === 3 && (
          <>
            <div className="onb-rec">
              <span className="grow-kicker">{tr("We recommend")}</span>
              <strong className="onb-rec-level">{tr(LEVELS[rec.level].title)}</strong>
              <p>{tr(LEVELS[rec.level].promise)}</p>
              <strong className="small">{tr("Why")}</strong>
              <ul>
                {rec.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
            <p className="muted small">
              {tr("You decide. Pick any level — you can change it later in Settings → Features & business level without losing data.")}
            </p>
            <div className="lvl-grid" role="radiogroup" aria-label={tr("Business level")}>
              {LEVEL_ORDER.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={level === l}
                  className={`lvl-card${level === l ? " current" : ""}`}
                  onClick={() => setChosen(l)}
                >
                  <span className="lvl-card-top">
                    <strong>{tr(LEVELS[l].title)}</strong>
                    {l === rec.level && <span className="badge tone-ok">{tr("Recommended")}</span>}
                    {l === currentLevel && l !== rec.level && <span className="badge tone-off">{tr("Current")}</span>}
                  </span>
                  <span className="lvl-promise">{tr(LEVELS[l].promise)}</span>
                </button>
              ))}
            </div>
            {ready ? (
              <form action={finishAction} className="onb-finish">
                <input type="hidden" name="level" value={level} />
                <input type="hidden" name="profile" value={JSON.stringify(profile)} />
                <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Setting up…")}>
                  {level === "small"
                    ? tr("Start with Small level")
                    : level === "medium"
                      ? tr("Start with Medium level")
                      : tr("Start with Enterprise level")}
                </SubmitButton>
              </form>
            ) : (
              <p className="notice notice-error">
                <span className="notice-icon" aria-hidden>
                  !
                </span>
                <span>{tr("Run the Stage 11 database update first (Supabase → SQL editor).")}</span>
              </p>
            )}
          </>
        )}

        <div className="onb-nav">
          {step > 0 ? (
            <button type="button" className="btn" onClick={() => setStep((s) => s - 1)}>
              {tr("Back")}
            </button>
          ) : (
            <a className="btn btn-ghost" href="/">
              {tr("Skip for now")}
            </a>
          )}
          {step < STEPS.length - 1 && (
            <button type="button" className="btn btn-primary" onClick={() => setStep((s) => s + 1)}>
              {step === 2 ? tr("See my recommendation") : tr("Next")}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
