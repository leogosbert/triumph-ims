"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { AskAnswer } from "@/lib/ai/ask";
import { askQuestion } from "@/lib/ai/ask-actions";
import { useTr } from "@/lib/tr-client";
import { AnswerView } from "./AnswerView";

/** The answer on the /search page: asked at once with ?ask=1, otherwise on a tap. */
export function AskPanel({ question, auto }: { question: string; auto: boolean }) {
  const tr = useTr();
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const asked = useRef<string | null>(null);

  const ask = () => {
    asked.current = question;
    setFailed(false);
    start(async () => {
      try {
        setAnswer(await askQuestion(question));
      } catch {
        setFailed(true);
      }
    });
  };

  useEffect(() => {
    setAnswer(null);
    if (auto && question && asked.current !== question) ask();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, auto]);

  if (!question) return null;
  return (
    <section className="card" aria-live="polite">
      {pending ? (
        <p className="as-typing" aria-label={tr("Thinking…")}>
          <span />
          <span />
          <span />
        </p>
      ) : answer ? (
        <AnswerView a={answer} />
      ) : failed ? (
        <p className="muted small">{tr("Something went wrong. Please try again.")}</p>
      ) : (
        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-primary" onClick={ask}>
            {tr("Ask AI")}
          </button>
          <span className="muted small">{tr("Get an answer about your business, the App guide or the documents you need, with the sources.")}</span>
        </div>
      )}
    </section>
  );
}
