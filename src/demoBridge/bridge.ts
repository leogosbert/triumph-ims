import { DEMO_TYPE, DEMO_VERSION, isRequest, type Event as DemoEvent, type Request, type SeatState } from './protocol'
import {
  accessibleName,
  attachFiles,
  bringIntoView,
  choose,
  clearHighlight,
  DemoError,
  fileOpener,
  highlight,
  interactive,
  press,
  roleOf,
  sleep,
  typeInto,
  waitForTarget,
  waitGone,
} from './dom'

// The demo bridge: answers commands from the LeMo Demonstrator page that holds this app in an
// <iframe>, and tells it what happens in the frame. It is installed only when demo mode is on (demoConfig.ts),
// accepts messages only from the parent window and only from an allowed origin, and never sends field values.

export type BridgeDeps = {
  /** The window the app runs in (listens for messages here). */
  win: Window
  /** The parent page; only messages whose source is this window are read. */
  parent: Window
  origins: string[]
  seat: string | null
  app?: string
  /** The signed-in email, or null. */
  currentEmail: () => Promise<string | null>
  /** Ends this seat's sign-in on this device only. */
  signOutLocal: () => Promise<void>
  /** Moves the app to a path inside the app. */
  navigate?: (path: string) => void
  /** The app's sign-in page and how to find its fields. */
  signInPath?: string
  signInFields?: { email: string; password: string; submit: string }
}

const SIGN_IN_FIELDS = {
  email: 'form input[type="email"]',
  password: 'form input[autocomplete="current-password"]',
  submit: 'form button[type="submit"]',
}

/** In-app navigation without a page load: the router follows history changes announced with popstate. */
export function historyNavigate(win: Window, path: string) {
  win.history.pushState({ idx: (win.history.state as { idx?: number } | null)?.idx ?? 0 }, '', path)
  win.dispatchEvent(new PopStateEvent('popstate', { state: win.history.state }))
}

const isAppPath = (p: unknown): p is string =>
  typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !p.includes('\\') && p.length < 512

export function installDemoBridge(deps: BridgeDeps): () => void {
  const { win, parent, origins } = deps
  const app = deps.app ?? 'lemosp'
  const signInPath = deps.signInPath ?? '/sign-in'
  const fields = deps.signInFields ?? SIGN_IN_FIELDS
  const doc = win.document
  const navigate = deps.navigate ?? ((p: string) => historyNavigate(win, p))
  let parentOrigin: string | null = null
  let lastUrl = win.location.href

  const post = (e: DemoEvent) => {
    if (!parentOrigin) return
    parent.postMessage({ type: DEMO_TYPE, v: DEMO_VERSION, seat: deps.seat, ...e }, parentOrigin)
  }

  const state = async (): Promise<SeatState> => {
    const email = await deps.currentEmail().catch(() => null)
    return {
      seat: deps.seat,
      app,
      url: win.location.href,
      path: win.location.pathname + win.location.search,
      signedIn: !!email,
      email,
      title: doc.title,
    }
  }

  async function signIn(email: string, password: string, next?: string) {
    if (typeof email !== 'string' || !email.includes('@') || typeof password !== 'string' || !password)
      throw new DemoError('BAD_REQUEST', 'An email and a password are needed')
    if (next !== undefined && !isAppPath(next))
      throw new DemoError('BAD_REQUEST', 'The page to open after sign-in must be a path in the app')
    const now = await deps.currentEmail()
    if (now && now.toLowerCase() === email.toLowerCase()) {
      if (next) navigate(next)
      return
    }
    if (now) await deps.signOutLocal()
    // The normal sign-in screen, filled in and pressed like a person would.
    navigate(signInPath)
    const emailField = await waitForTarget({ selector: fields.email }, 15_000, doc)
    highlight(emailField, 900, undefined, doc)
    await typeInto(emailField, email, 500)
    const pw = await waitForTarget({ selector: fields.password }, 5_000, doc)
    highlight(pw, 700, undefined, doc)
    await typeInto(pw, password, 0)
    const btn = await waitForTarget({ selector: fields.submit }, 5_000, doc)
    highlight(btn, 600, undefined, doc)
    await sleep(350)
    press(btn)
    const end = Date.now() + 25_000
    // A press that lands while the page is still starting up can be lost; press again if nothing has happened.
    let again = Date.now() + 7_000
    for (;;) {
      if (Date.now() >= again && win.location.pathname.startsWith(signInPath) && !(btn as HTMLButtonElement).disabled && btn.isConnected) {
        again = Date.now() + 7_000
        press(btn)
      }
      const signed = await deps.currentEmail().catch(() => null)
      if (signed && !win.location.pathname.startsWith(signInPath)) break
      const alert = doc.querySelector('form [role="alert"]')
      if (alert && !signed) throw new DemoError('SIGN_IN_FAILED', alert.textContent?.trim() || 'Sign-in was refused')
      if (Date.now() >= end) throw new DemoError('TIMEOUT', 'Sign-in did not finish')
      await sleep(150)
    }
    clearHighlight()
    // The app opens its home page after sign-in; then go where the table asked.
    if (next) {
      await sleep(300)
      navigate(next)
    }
  }

  /**
   * A drop-down list drawn by the app (Mantine Select or Autocomplete): opens it like a person would, then presses the
   * option whose text matches. The list opens in a layer at the end of the page, so options are looked for there.
   */
  async function chooseFromList(el: Element, option: string | undefined, index: number | undefined): Promise<string> {
    if (option === undefined && index === undefined) throw new DemoError('BAD_REQUEST', 'Say which choice to make')
    press(el)
    if (el instanceof HTMLInputElement) el.focus()
    const target = option !== undefined ? { role: 'option', name: option } : { role: 'option', nth: index }
    const o = await waitForTarget(target, 5_000, doc)
    highlight(o, 400, undefined, doc)
    await sleep(300)
    press(o)
    return accessibleName(o).slice(0, 80)
  }

  async function run(m: Request): Promise<unknown> {
    switch (m.cmd) {
      case 'hello':
      case 'state':
        return state()
      case 'signIn':
        await signIn(m.email, m.password, m.next)
        return state()
      case 'signOut':
        await deps.signOutLocal()
        navigate(signInPath)
        return state()
      case 'navigate':
        if (!isAppPath(m.path)) throw new DemoError('BAD_REQUEST', 'Only paths inside the app can be opened')
        navigate(m.path)
        await sleep(50)
        return state()
      case 'highlight': {
        const el = await waitForTarget(m.target, 10_000, doc)
        bringIntoView(el)
        highlight(el, m.ms ?? 1200, m.label, doc)
        return { found: accessibleName(el).slice(0, 80) }
      }
      case 'clearHighlight':
        clearHighlight()
        return null
      case 'click': {
        const el = await waitForTarget(m.target, m.timeoutMs ?? 10_000, doc)
        bringIntoView(el)
        const ms = m.highlightMs ?? 900
        if (ms > 0) {
          highlight(el, 0, m.label, doc)
          await sleep(ms)
        }
        press(el)
        await sleep(ms > 0 ? 250 : 0)
        clearHighlight()
        return { pressed: accessibleName(el).slice(0, 80) }
      }
      case 'fill': {
        if (typeof m.value !== 'string') throw new DemoError('BAD_REQUEST', 'A value is needed')
        const el = await waitForTarget(m.target, m.timeoutMs ?? 10_000, doc)
        bringIntoView(el)
        const ms = m.highlightMs ?? 600
        if (ms > 0) {
          highlight(el, 0, m.label, doc)
          await sleep(ms)
        }
        await typeInto(el, m.value, m.typeMs ?? 600)
        clearHighlight()
        return null
      }
      case 'select': {
        const el = await waitForTarget(m.target, m.timeoutMs ?? 10_000, doc)
        bringIntoView(el)
        const ms = m.highlightMs ?? 600
        if (ms > 0) {
          highlight(el, 0, m.label, doc)
          await sleep(ms)
        }
        const chosen =
          el instanceof HTMLSelectElement
            ? choose(el, { value: m.value, option: m.option, index: m.index })
            : await chooseFromList(el, m.option ?? m.value, m.index)
        await sleep(ms > 0 ? 200 : 0)
        clearHighlight()
        return { chosen }
      }
      case 'upload': {
        const el = await waitForTarget(m.target, m.timeoutMs ?? 10_000, doc)
        // A file field is often hidden behind its label or a button; ring what the person would press.
        const shown = fileOpener(el)
        bringIntoView(shown)
        const ms = m.highlightMs ?? 700
        if (ms > 0) {
          highlight(shown, 0, m.label, doc)
          await sleep(ms)
        }
        attachFiles(el, m.files)
        await sleep(ms > 0 ? 250 : 0)
        clearHighlight()
        return { files: m.files.length }
      }
      case 'reload':
        // Answer first; the page then loads again and says ready once more after the next hello.
        win.setTimeout(() => win.location.reload(), 80)
        return null
      case 'waitFor':
        if (m.gone) await waitGone(m.target, m.timeoutMs ?? 10_000, doc)
        else await waitForTarget(m.target, m.timeoutMs ?? 10_000, doc)
        return null
    }
  }

  const onMessage = async (e: MessageEvent) => {
    if (e.source !== parent || !origins.includes(e.origin) || !isRequest(e.data)) return
    if (parentOrigin && e.origin !== parentOrigin) return
    const m = e.data
    if (m.cmd === 'hello') {
      parentOrigin = e.origin
      post({ kind: 'ready', state: await state() })
    }
    if (!parentOrigin) return
    try {
      const data = await run(m)
      post({ kind: 'result', id: m.id, ok: true, data })
    } catch (err) {
      const de =
        err instanceof DemoError ? err : new DemoError('FAILED', err instanceof Error ? err.message : String(err))
      clearHighlight()
      post({ kind: 'result', id: m.id, ok: false, error: { code: de.code, message: de.message } })
    }
  }

  // What a person presses inside the frame, so the table can show it. Labels only, never what was typed.
  const onClick = (e: MouseEvent) => {
    if (!e.isTrusted) return
    const el = interactive(e.target as Element | null)
    if (!el || el.matches('input, textarea, select')) return
    post({ kind: 'interaction', action: 'click', label: accessibleName(el).slice(0, 60), role: roleOf(el) })
  }
  const onChange = (e: globalThis.Event) => {
    if (!e.isTrusted) return
    const el = e.target as Element | null
    if (!el || !el.matches('input, textarea, select')) return
    post({ kind: 'interaction', action: 'change', label: accessibleName(el).slice(0, 60), role: roleOf(el) })
  }
  const urlTimer = win.setInterval(() => {
    if (win.location.href === lastUrl) return
    lastUrl = win.location.href
    post({ kind: 'url', url: lastUrl, path: win.location.pathname + win.location.search })
  }, 300)

  // A question the app asks with the browser's own box ("Record it again?") would freeze the whole table, so in a
  // demo seat it is answered yes, and the table is told what was asked.
  const nativeConfirm = win.confirm
  win.confirm = (message?: string) => {
    post({ kind: 'interaction', action: 'click', label: `OK: ${String(message ?? '').slice(0, 54)}`, role: 'dialog' })
    return true
  }

  const listener = (e: MessageEvent) => void onMessage(e)
  win.addEventListener('message', listener)
  doc.addEventListener('click', onClick, true)
  doc.addEventListener('change', onChange, true)
  return () => {
    win.removeEventListener('message', listener)
    doc.removeEventListener('click', onClick, true)
    doc.removeEventListener('change', onChange, true)
    win.clearInterval(urlTimer)
    win.confirm = nativeConfirm
    clearHighlight()
  }
}
