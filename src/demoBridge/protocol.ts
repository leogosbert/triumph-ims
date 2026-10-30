// LeMo demo bridge protocol, version 1 (docs/DEMO_BRIDGE.md). The same shapes live in the LeMo Command Center
// (src/lib/demonstrator/protocol.ts). Every message is a plain object sent with window.postMessage.

export const DEMO_TYPE = 'lemo-demo'
export const DEMO_VERSION = 1

/** How a command finds an element. The first field given wins: testId, then label, then role (+ name), then selector/text. */
export type Target = {
  /** data-testid or data-demo attribute. */
  testId?: string
  /** Visible label of a form field (<label>, aria-label or placeholder). */
  label?: string
  /** ARIA role, e.g. button, link, tab, menuitem, textbox, combobox, checkbox. */
  role?: string
  /** Accessible name to go with role. */
  name?: string
  /** Visible text; with selector, keeps only matches that contain this text. */
  text?: string
  /** CSS selector. */
  selector?: string
  /** Names and text match whole and case-sensitive instead of "contains, any case". */
  exact?: boolean
  /** Which match when several: first (default), last, or a 0-based index. */
  nth?: 'first' | 'last' | number
}

export type Command =
  | { cmd: 'hello'; seat?: string }
  | { cmd: 'state' }
  | { cmd: 'signIn'; email: string; password: string; next?: string }
  | { cmd: 'signOut' }
  | { cmd: 'navigate'; path: string }
  | { cmd: 'highlight'; target: Target; ms?: number; label?: string }
  | { cmd: 'clearHighlight' }
  | { cmd: 'click'; target: Target; highlightMs?: number; label?: string; timeoutMs?: number }
  | {
      cmd: 'fill'
      target: Target
      value: string
      highlightMs?: number
      label?: string
      typeMs?: number
      timeoutMs?: number
    }
  | {
      cmd: 'select'
      target: Target
      value?: string
      option?: string
      index?: number
      highlightMs?: number
      label?: string
      timeoutMs?: number
    }
  | { cmd: 'waitFor'; target: Target; gone?: boolean; timeoutMs?: number }
  | { cmd: 'upload'; target: Target; files: DemoFile[]; highlightMs?: number; label?: string; timeoutMs?: number }
  | { cmd: 'reload' }

/** A small made-up file the presenter's page creates (base64 content, at most 2 MB each). */
export type DemoFile = { name: string; type: string; base64: string }

export type CommandName = Command['cmd']

export type Request = Command & { type: typeof DEMO_TYPE; v: typeof DEMO_VERSION; id: string }

export type SeatState = {
  seat: string | null
  app: string
  url: string
  path: string
  signedIn: boolean
  email: string | null
  title: string
}

export type ErrorCode = 'NOT_FOUND' | 'TIMEOUT' | 'BAD_REQUEST' | 'SIGN_IN_FAILED' | 'FAILED'

/** Messages from the app frame to the parent page. */
export type Event =
  | { kind: 'ready'; state: SeatState }
  | { kind: 'result'; id: string; ok: true; data?: unknown }
  | { kind: 'result'; id: string; ok: false; error: { code: ErrorCode; message: string } }
  | { kind: 'url'; url: string; path: string }
  | { kind: 'interaction'; action: 'click' | 'change'; label: string; role: string }

export type Outgoing = Event & { type: typeof DEMO_TYPE; v: typeof DEMO_VERSION; seat: string | null }

export const COMMANDS: readonly CommandName[] = [
  'hello',
  'state',
  'signIn',
  'signOut',
  'navigate',
  'highlight',
  'clearHighlight',
  'click',
  'fill',
  'select',
  'waitFor',
  'upload',
  'reload',
]

/** True for a well-formed version 1 request. Anything else is ignored without a reply. */
export function isRequest(d: unknown): d is Request {
  if (!d || typeof d !== 'object') return false
  const m = d as Record<string, unknown>
  return (
    m.type === DEMO_TYPE &&
    m.v === DEMO_VERSION &&
    typeof m.id === 'string' &&
    m.id.length > 0 &&
    m.id.length <= 64 &&
    COMMANDS.includes(m.cmd as CommandName)
  )
}
