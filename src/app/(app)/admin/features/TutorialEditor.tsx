"use client";

import { useState } from "react";
import { useTr } from "@/lib/tr-client";

type Step = { id: number; title: string; body: string };

/** Edits a feature's tutorial: a short list of steps, each with a title and a body. */
export function TutorialEditor({ initial }: { initial: { title: string; body: string }[] }) {
  const tr = useTr();
  const [steps, setSteps] = useState<Step[]>(initial.map((s, i) => ({ id: i + 1, title: s.title ?? "", body: s.body ?? "" })));
  const [nextId, setNextId] = useState<number>(initial.length + 1);

  const update = (id: number, patch: Partial<Step>) => setSteps((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: number) => setSteps((all) => all.filter((s) => s.id !== id));
  const move = (id: number, dir: -1 | 1) =>
    setSteps((all) => {
      const i = all.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= all.length) return all;
      const copy = all.slice();
      [copy[i], copy[j]] = [copy[j], copy[i]];
      return copy;
    });
  const add = () => {
    setSteps((all) => [...all, { id: nextId, title: "", body: "" }]);
    setNextId(nextId + 1);
  };

  return (
    <div className="adm-tutorial">
      {steps.length === 0 && <p className="muted small">{tr("No tutorial steps yet.")}</p>}
      <ol>
        {steps.map((s, i) => (
          <li key={s.id} className="adm-step">
            <div className="adm-step-head">
              <strong>
                {tr("Step")} {i + 1}
              </strong>
              <span className="adm-step-tools">
                <button type="button" className="btn btn-small" onClick={() => move(s.id, -1)} disabled={i === 0} aria-label={tr("Move up")}>
                  ↑
                </button>
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => move(s.id, 1)}
                  disabled={i === steps.length - 1}
                  aria-label={tr("Move down")}
                >
                  ↓
                </button>
                <button type="button" className="btn btn-small" onClick={() => remove(s.id)}>
                  {tr("Remove")}
                </button>
              </span>
            </div>
            <input
              name="tutorial_title"
              value={s.title}
              maxLength={80}
              placeholder={tr("Step title, e.g. Add your first product")}
              aria-label={tr("Step title")}
              onChange={(e) => update(s.id, { title: e.target.value })}
            />
            <textarea
              name="tutorial_body"
              value={s.body}
              rows={2}
              maxLength={600}
              placeholder={tr("One or two simple sentences.")}
              aria-label={tr("Step text")}
              onChange={(e) => update(s.id, { body: (e.target as unknown as HTMLTextAreaElement).value })}
            />
          </li>
        ))}
      </ol>
      {steps.length < 10 && (
        <button type="button" className="btn btn-small" onClick={add}>
          {tr("+ Add step")}
        </button>
      )}
    </div>
  );
}
