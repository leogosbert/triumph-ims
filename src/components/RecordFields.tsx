import { tr } from "@/lib/tr";
import type { FieldDef, Section } from "@/lib/fields";

type Values = Record<string, unknown>;

function asText(v: unknown) {
  if (v === null || v === undefined) return "";
  return String(v);
}

function Input({ f, value, disabled }: { f: FieldDef; value: unknown; disabled: boolean }) {
  const id = `f-${f.key}`;
  const common = { id, name: f.key, disabled, required: f.required };
  switch (f.type) {
    case "textarea":
      return <textarea {...common} defaultValue={asText(value)} />;
    case "select": {
      const current = asText(value);
      const options = f.options ?? [];
      // Keep a value that came from an import even if it isn't in the list.
      const all = current && !options.includes(current) ? [current, ...options] : options;
      return (
        <select {...common} defaultValue={current}>
          {!f.required && <option value="">—</option>}
          {all.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    case "bool":
      return (
        <select {...common} defaultValue={value === true ? "true" : "false"}>
          <option value="false">{tr("No")}</option>
          <option value="true">{tr("Yes")}</option>
        </select>
      );
    case "money":
    case "number":
    case "integer":
      return (
        <input
          {...common}
          type="text"
          inputMode={f.type === "integer" ? "numeric" : "decimal"}
          defaultValue={value === null || value === undefined ? "" : Number(value).toLocaleString("en-GB")}
        />
      );
    case "email":
      return <input {...common} type="email" defaultValue={asText(value)} />;
    case "tel":
      return <input {...common} type="tel" defaultValue={asText(value)} />;
    default:
      return <input {...common} type="text" defaultValue={asText(value)} />;
  }
}

/** Renders form sections from field definitions. */
export function RecordFields({
  sections,
  values,
  readOnly = false,
  lockedKeys = [],
}: {
  sections: Section[];
  values: Values;
  readOnly?: boolean;
  lockedKeys?: string[];
}) {
  return (
    <>
      {sections.map((s) => (
        <section key={s.title} className="card">
          <h2>{tr(String(s.title ?? ""))}</h2>
          <div className="grid grid-2">
            {s.fields.map((f) => {
              const locked = readOnly || lockedKeys.includes(f.key);
              return (
                <div key={f.key} className="field" style={f.wide ? { gridColumn: "1 / -1" } : undefined}>
                  <label htmlFor={`f-${f.key}`}>
                    {tr(String(f.label ?? ""))} {f.required && !locked && <span className="hint">{tr("· required")}</span>}
                    {f.hint && !locked && <span className="hint"> · {tr(String(f.hint ?? ""))}</span>}
                  </label>
                  <Input f={f} value={values[f.key]} disabled={locked} />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
