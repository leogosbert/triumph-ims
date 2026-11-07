/**
 * Checks for common form fields, as HTML `pattern` attributes (browsers match the whole value and
 * read them with the "v" regex flag, so -, ( and ) are escaped inside [ ]). <FieldChecks> shows the
 * `title` text under the field when a value doesn't match. Amounts stay type="text" with a
 * decimal keypad, because people type "1,890,000"; the server still checks everything (toNumber).
 */
export const PATTERNS = {
  /** TRA TIN: 9 digits, optionally written 123-456-789. */
  tin: { pattern: "[0-9]{3}[\\- ]?[0-9]{3}[\\- ]?[0-9]{3}", title: "A TIN has 9 digits, like 123-456-789." },
  /**
   * A phone number: an optional +, then digits with spaces, dashes or brackets, at least 8 characters.
   * "/" and "," are allowed so a saved "0754 123 456 / 0713 222 333" can still be edited.
   */
  phone: { pattern: "[+]?[0-9][0-9 \\(\\)\\-\\/,+]{7,59}", title: "Enter a phone number, like 0754 123 456 or +255 754 123 456." },
  /** A quantity above 0 ("1", "2.5", "1,000"). */
  qty: { pattern: "(?=.*[1-9])[0-9][0-9, ]*([.][0-9]+)?|(?=.*[1-9])[.][0-9]+", title: "Enter a quantity above 0." },
  /** An amount of 0 or more ("0", "15000", "1,890,000.50"). */
  amount: { pattern: "[0-9][0-9, ]*([.][0-9]+)?|[.][0-9]+", title: "Enter an amount of 0 or more, digits only." },
  /** A whole number of 0 or more. */
  whole: { pattern: "[0-9][0-9, ]*", title: "Enter a whole number of 0 or more." },
} as const;

export type PatternKey = keyof typeof PATTERNS;

/** `pattern` and `title` for an input: `<input {...checkAttrs("qty", tr)} />`. */
export function checkAttrs(key: PatternKey, tr: (s: string) => string) {
  return { pattern: PATTERNS[key].pattern, title: tr(PATTERNS[key].title) };
}
