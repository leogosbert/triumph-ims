/**
 * The one place that talks to the outside AI service (Anthropic's Messages API), on the server only.
 * The key (ANTHROPIC_API_KEY) and model (ANTHROPIC_MODEL) are Netlify environment variables; they never
 * reach the browser. Import this only from server code ("use server" actions, server components).
 * Same pattern as src/lib/assistant.ts: plain fetch, a time limit, and null on any failure so the
 * caller can fall back to the built-in answer.
 */

export function aiReady(): boolean {
  return !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_MODEL);
}

export type AiBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string } }
  | { type: "document"; source: { type: "base64"; media_type: "application/pdf"; data: string } };

export type AiResult = { ok: true; text: string } | { ok: false; reason: "off" | "timeout" | "refused" | "failed"; status?: number };

/**
 * One request, one answer. Thinking blocks (newer models think by default) are skipped; only the
 * text comes back. No temperature or other sampling settings: newer models refuse them.
 */
export async function callClaude(opts: { system: string; content: AiBlock[]; maxTokens: number; timeoutMs: number }): Promise<AiResult> {
  if (!aiReady()) return { ok: false, reason: "off" };
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL,
        max_tokens: opts.maxTokens,
        system: opts.system,
        messages: [{ role: "user", content: opts.content }],
      }),
      signal: AbortSignal.timeout(opts.timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false, reason: "failed", status: res.status };
    const body = (await res.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] };
    if (body.stop_reason === "refusal") return { ok: false, reason: "refused" };
    const text = (body.content ?? [])
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("\n")
      .trim();
    return text ? { ok: true, text } : { ok: false, reason: "failed" };
  } catch (e) {
    const name = (e as { name?: string } | null)?.name;
    return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "failed" };
  }
}
