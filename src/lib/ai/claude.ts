/**
 * The one place that talks to the outside AI service (Anthropic's Messages API), on the server only.
 * The key (ANTHROPIC_API_KEY) is a Netlify environment variable and never reaches the browser.
 * ANTHROPIC_MODEL is optional (default claude-opus-5-5, as in the Cocozania app).
 * Import this only from server code ("use server" actions, server components).
 *
 * Like Cocozania's netlify/functions/ask.mts: structured JSON output (a schema), low effort, and the
 * server-side refusal fallback. If the configured model does not accept those settings (an older
 * model answers 400), the request is sent once more as a plain request and the reply is parsed and
 * checked the same way. Returns a reason instead of throwing, so callers fall back to the built-in answer.
 */

export const DEFAULT_MODEL = "claude-opus-5-5";

/**
 * Each AI call must finish in about 9 seconds end to end: Netlify stops a server function at 10 s, and
 * people on a phone will not wait longer. The request is cancelled (AbortController) at this limit and
 * the caller shows "took too long, try a clearer or smaller photo". Keep max_tokens short and effort low.
 */
export const AI_TIMEOUT_MS = 8500;

export function aiReady(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export function aiModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

export type AiBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export type AiResult = { ok: true; text: string } | { ok: false; reason: "off" | "timeout" | "refused" | "failed"; status?: number };

type Opts = {
  system: string;
  content: AiBlock[];
  maxTokens: number;
  timeoutMs: number;
  /** JSON schema for the reply (structured output). */
  schema?: Record<string, unknown>;
  effort?: "low" | "medium" | "high";
};

async function send(opts: Opts, rich: boolean, signal: AbortSignal): Promise<AiResult> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-api-key": process.env.ANTHROPIC_API_KEY!,
    "anthropic-version": "2023-06-01",
  };
  const body: Record<string, unknown> = {
    model: aiModel(),
    max_tokens: opts.maxTokens,
    system: opts.system,
    messages: [{ role: "user", content: opts.content }],
  };
  if (rich) {
    headers["anthropic-beta"] = "server-side-fallback-2026-07-01";
    body.fallbacks = "default";
    body.output_config = {
      ...(opts.effort ? { effort: opts.effort } : {}),
      ...(opts.schema ? { format: { type: "json_schema", schema: opts.schema } } : {}),
    };
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers, body: JSON.stringify(body), signal, cache: "no-store" });
  if (!res.ok) return { ok: false, reason: "failed", status: res.status };
  const json = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
  if (json.stop_reason === "refusal") return { ok: false, reason: "refused" };
  // Thinking and fallback blocks are skipped; only the text is the answer.
  const text = (json.content ?? [])
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("")
    .trim();
  return text ? { ok: true, text } : { ok: false, reason: "failed" };
}

/** One request, one answer. No temperature or other sampling settings: newer models refuse them. */
export async function callClaude(opts: Opts): Promise<AiResult> {
  if (!aiReady()) return { ok: false, reason: "off" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(opts.timeoutMs, AI_TIMEOUT_MS));
  const signal = controller.signal;
  try {
    const first = await send(opts, true, signal);
    if (!first.ok && first.reason === "failed" && first.status === 400) return await send(opts, false, signal);
    return first;
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    return { ok: false, reason: name === "TimeoutError" || name === "AbortError" || signal.aborted ? "timeout" : "failed" };
  } finally {
    clearTimeout(timer);
  }
}
