/**
 * Password rules for LeMoSp, used on sign-up, password change and reset.
 * Same rules run in the browser (instant feedback) and on the server (cannot be skipped).
 */
export const MIN_PASSWORD = 10;

// The most common passwords and patterns seen in leaks (lower-case).
const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "12345678", "123456789", "1234567890", "123123123",
  "qwerty", "qwerty123", "qwertyuiop", "111111111", "000000000", "iloveyou", "welcome", "welcome1",
  "admin", "admin123", "letmein", "football", "monkey", "dragon", "sunshine", "princess", "abc123",
  "tanzania", "tanzania1", "daressalaam", "dar es salaam", "mungu", "yesu", "jesus", "simba", "yanga",
  "lemosp", "lemo", "triumph", "supplier", "suppliers", "company", "changeme", "secret", "asdfghjkl",
]);

export type PasswordCheck = {
  ok: boolean;
  /** 0 (very weak) – 4 (strong) */
  score: number;
  problems: string[];
};

export function checkPassword(pw: string, context: string[] = []): PasswordCheck {
  const problems: string[] = [];
  const lower = pw.toLowerCase();
  if (pw.length < MIN_PASSWORD) problems.push("Use at least 10 characters.");
  const kinds = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (kinds < 3) problems.push("Mix at least three of: small letters, CAPITALS, numbers, symbols.");
  const base = lower.replace(/[^a-z]/g, "");
  if (COMMON.has(lower) || COMMON.has(base)) problems.push("This password is too common.");
  if (/(.)\1{3,}/.test(pw)) problems.push("Avoid repeating the same character.");
  if (/(0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf)/i.test(pw)) problems.push("Avoid easy sequences like 1234 or qwer.");
  for (const c of context) {
    const word = c.toLowerCase().split(/[@\s.]+/).find((w) => w.length >= 4);
    if (word && lower.includes(word)) {
      problems.push("Don't use your name, email or company name in the password.");
      break;
    }
  }
  let score = 0;
  if (pw.length >= MIN_PASSWORD) score++;
  if (pw.length >= 14) score++;
  if (kinds >= 3) score++;
  if (kinds === 4 || pw.length >= 18) score++;
  if (problems.length > 0) score = Math.min(score, 1);
  return { ok: problems.length === 0, score, problems };
}

export const STRENGTH_LABELS = ["Very weak", "Weak", "Fair", "Good", "Strong"];
