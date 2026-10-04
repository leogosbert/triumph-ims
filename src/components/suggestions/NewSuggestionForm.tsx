"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { SUGGESTION_CATEGORIES } from "@/components/suggestions/meta";
import { useTr } from "@/lib/tr-client";

type Person = { id: string; name: string; role: string };

/** Suggestion form. Management can switch it to an internal improvement and assign it straight away. */
export function NewSuggestionForm({
  action,
  isManager,
  people,
}: {
  action: (form: FormData) => void | Promise<void>;
  isManager: boolean;
  people: Person[];
}) {
  const tr = useTr();
  const [category, setCategory] = useState<string>("");
  const [internal, setInternal] = useState<boolean>(false);
  const help = SUGGESTION_CATEGORIES.find((c) => c.key === category)?.help;

  return (
    <form action={action} className="card sg-form">
      {isManager && (
        <div className="field">
          <span className="sg-label">{tr("What are you creating?")}</span>
          <div className="seg" role="group" aria-label={tr("What are you creating?")}>
            <button type="button" aria-pressed={!internal} onClick={() => setInternal(false)}>
              {tr("Suggestion")}
            </button>
            <button type="button" aria-pressed={internal} onClick={() => setInternal(true)}>
              {tr("Internal improvement")}
            </button>
          </div>
          {internal && <input type="hidden" name="internal" value="on" />}
          <p className="hint">
            {internal
              ? tr("An improvement task for the team. It is approved straight away and can be assigned to someone.")
              : tr("Your idea goes to management for review.")}
          </p>
        </div>
      )}

      <div className="field">
        <label htmlFor="sg-category">{tr("Category")}</label>
        <select id="sg-category" name="category" required value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="" disabled>
            {tr("Choose a category")}
          </option>
          {SUGGESTION_CATEGORIES.map((c) => (
            <option key={c.key} value={c.key}>
              {tr(c.label)}
            </option>
          ))}
        </select>
        <p className="hint">{help ? tr(help) : tr("Pick the area your idea is mostly about.")}</p>
      </div>

      <div className="field">
        <label htmlFor="sg-title">{tr("Title")}</label>
        <input
          id="sg-title"
          name="title"
          required
          minLength={3}
          maxLength={140}
          placeholder={tr("e.g. Call customers two days before delivery")}
        />
      </div>

      <div className="field">
        <label htmlFor="sg-body">{tr("Details")}</label>
        <textarea
          id="sg-body"
          name="body"
          rows={6}
          maxLength={4000}
          placeholder={tr("What is the problem or opportunity? What do you suggest? How would it help?")}
        />
      </div>

      {internal ? (
        <>
          <div className="field">
            <label htmlFor="sg-assign">{tr("Assign to (optional)")}</label>
            <select id="sg-assign" name="assign_to" defaultValue="">
              <option value="">{tr("Not assigned yet")}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="sg-dept">{tr("Department (optional)")}</label>
            <input id="sg-dept" name="department" maxLength={80} placeholder={tr("e.g. Stores, Sales, Finance")} />
          </div>
        </>
      ) : (
        <label className="check sg-check">
          <input type="checkbox" name="about_app" />
          <span>{tr("This is feedback about the LeMoSp app itself (shared anonymously with LeMo Tech to improve the product)")}</span>
        </label>
      )}

      <SubmitButton className="btn btn-primary btn-block" pendingText={tr("Sending…")}>
        {internal ? tr("Create improvement") : tr("Send suggestion")}
      </SubmitButton>
    </form>
  );
}
