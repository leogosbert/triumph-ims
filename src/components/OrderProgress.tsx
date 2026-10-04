/** Where an order stands, from quotation to payment. */
export function OrderProgress({ steps }: { steps: { label: string; done: boolean }[] }) {
  const current = steps.findIndex((s) => !s.done);
  const at = current === -1 ? steps.length - 1 : current;
  return (
    <section className="card progress-card" aria-label="Order progress">
      <div className="progress-head">
        <span>Order progress</span>
        <span>
          {current === -1 ? steps.length : current + 1} / {steps.length}
        </span>
      </div>
      <ol className="progress-bar">
        {steps.map((s, i) => (
          <li key={s.label} className={s.done ? "done" : i === at ? "now" : ""} title={s.label}>
            <span className="sr-only">
              {s.label}: {s.done ? "done" : i === at ? "next" : "to do"}
            </span>
          </li>
        ))}
      </ol>
      <div className="progress-labels">
        <span className="muted">{steps.filter((s) => s.done).map((s) => s.label).slice(-2).join(" ✓ · ")}{steps.some((s) => s.done) ? " ✓" : ""}</span>
        {current !== -1 && <strong>Next: {steps[current].label}</strong>}
      </div>
    </section>
  );
}
