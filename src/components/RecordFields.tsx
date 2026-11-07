import { tr } from "@/lib/tr";
import type { FieldDef, Section } from "@/lib/fields";
import { ScanButton } from "@/components/ScanButton";
import { PATTERNS, type PatternKey } from "@/lib/patterns";

type Values = Record<string, unknown>;

function asText(v: unknown) {
  if (v === null || v === undefined) return "";
  return String(v);
}

/** The live check for a text field (FieldChecks shows its title under the field when it doesn't match). */
function checkFor(f: FieldDef): PatternKey | null {
  if (f.check !== undefined) return f.check;
  if (f.key === "tin") return "tin";
  if (f.type === "tel") return "phone";
  if (f.type === "money" || f.type === "number") return "amount";
  if (f.type === "integer") return "whole";
  return null;
}

function Input({ f, value, disabled }: { f: FieldDef; value: unknown; disabled: boolean }) {
  const id = `f-${f.key}`;
  const common = { id, name: f.key, disabled, required: f.required };
  const check = f.type === "textarea" || f.type === "select" || f.type === "bool" ? null : checkFor(f);
  const checked = check ? { pattern: PATTERNS[check].pattern, title: tr(PATTERNS[check].title) } : {};
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
              {f.labels?.[o] ? tr(f.labels[o]) : o}
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
          {...checked}
          type="text"
          inputMode={f.type === "integer" ? "numeric" : "decimal"}
          enterKeyHint="next"
          autoComplete="off"
          defaultValue={value === null || value === undefined ? "" : Number(value).toLocaleString("en-GB")}
        />
      );
    case "email":
      return <input {...common} type="email" defaultValue={asText(value)} />;
    case "tel":
      return <input {...common} {...checked} type="tel" defaultValue={asText(value)} enterKeyHint="next" />;
    default:
      // A code that can be read from a barcode (SKU): the camera Scan button sits beside it.
      if (f.scan && !disabled) {
        return (
          <div className="scan-field">
            <input {...common} {...checked} type="text" defaultValue={asText(value)} autoComplete="off" />
            <ScanButton target={id} />
          </div>
        );
      }
      return <input {...common} {...checked} type="text" defaultValue={asText(value)} />;
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
