/**
 * Recording constants and file names shared by the browser recorder, the server and the background function
 * (no imports, nothing secret).
 */

export const RECORDING_BUCKET = "meeting-recordings";
/** OpenAI's limit for one transcription request is 25 MB; the browser starts a new recording well before that. */
export const TRANSCRIBE_MAX_BYTES = 24 * 1024 * 1024;
/** The browser starts a new recording (a new file) after this long, so each stays small enough to transcribe. */
export const RECORDING_ROLLOVER_MS = 40 * 60_000;
/** How often the browser uploads a piece of the recording. */
export const RECORDING_SLICE_MS = 20_000;

/** The file name and type to send for a recording's mime ("audio/webm;codecs=opus" -> recording.webm). */
export function fileNameFor(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "recording.mp4";
  if (m.includes("ogg")) return "recording.ogg";
  if (m.includes("mpeg")) return "recording.mp3";
  return "recording.webm";
}

/** The piece's file extension for a mime. */
export function extFor(mime: string): string {
  return fileNameFor(mime).split(".").pop()!;
}
