import type { Target } from './protocol'

// Finding and pressing elements for the demo bridge, in plain DOM so it works on every screen without
// changes to the screens. Matching follows the same rules as the end-to-end tests: labels and names match when they
// contain the words, in any case, unless `exact` is set.

const esc = (s: string) =>
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(s) : s.replace(/["\\[\]]/g, '\\$&')

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()

function matches(have: string, want: string, exact?: boolean) {
  const h = norm(have)
  const w = norm(want)
  if (!w) return false
  return exact ? h === w : h.toLowerCase().includes(w.toLowerCase())
}

const ROLE_SELECTORS: Record<string, string> = {
  button: 'button, [role="button"], input[type="button"], input[type="submit"], input[type="reset"]',
  link: 'a[href], [role="link"]',
  tab: '[role="tab"]',
  menuitem: '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]',
  textbox:
    'input:not([type]), input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="search"], input[type="password"], input[type="url"], input[type="date"], input[type="time"], textarea, [role="textbox"]',
  combobox: 'select, [role="combobox"]',
  checkbox: 'input[type="checkbox"], [role="checkbox"], [role="switch"]',
  radio: 'input[type="radio"], [role="radio"]',
  option: '[role="option"], option',
  heading: 'h1, h2, h3, h4, h5, h6, [role="heading"]',
}

/** A short accessible name: aria-label, aria-labelledby, field labels, alt, then visible text. */
export function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return norm(aria)
  const by = el.getAttribute('aria-labelledby')
  if (by) {
    const t = by
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? '')
      .join(' ')
    if (norm(t)) return norm(t)
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const labels = [...(el.labels ?? [])].map((l) => l.textContent ?? '').join(' ')
    if (norm(labels)) return norm(labels)
    if (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type)) return norm(el.value)
    const ph = el.getAttribute('placeholder')
    if (ph) return norm(ph)
  }
  if (el instanceof HTMLImageElement) return norm(el.alt)
  return norm(el.textContent) || norm(el.getAttribute('title'))
}

function hasLayout(doc: Document) {
  return doc.documentElement.getClientRects().length > 0
}

/** Visible on screen: not inside something hidden, inert or display:none, and (in a real browser) has a box. */
export function isVisible(el: Element): boolean {
  const win = el.ownerDocument.defaultView
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute('hidden') || n.getAttribute('aria-hidden') === 'true' || n.hasAttribute('inert')) return false
    const s = win?.getComputedStyle(n)
    if (s && (s.display === 'none' || s.visibility === 'hidden')) return false
  }
  return !hasLayout(el.ownerDocument) || el.getClientRects().length > 0
}

const isOurs = (el: Element) => !!el.closest('[data-lemo-demo-overlay]')

/** Controls named by a label: <label> text, aria-label or placeholder. */
function byLabel(doc: Document, want: string, exact?: boolean): Element[] {
  const out: Element[] = []
  for (const l of doc.querySelectorAll('label')) {
    if (!matches(l.textContent ?? '', want, exact)) continue
    const c = l.control ?? l.querySelector('input, select, textarea')
    if (c) out.push(c)
  }
  for (const el of doc.querySelectorAll('input, select, textarea, [role="textbox"], [role="combobox"]')) {
    const a = el.getAttribute('aria-label') ?? el.getAttribute('placeholder')
    if (a && matches(a, want, exact)) out.push(el)
  }
  return out
}

/** The smallest elements whose text contains the words (like getByText). */
function byText(doc: Document, want: string, exact?: boolean, within?: Element[]): Element[] {
  if (within) return within.filter((el) => matches(el.textContent ?? '', want, exact))
  const out: Element[] = []
  const all = doc.body ? [doc.body, ...doc.body.querySelectorAll('*')] : []
  for (const el of all) {
    if (el instanceof HTMLScriptElement || el instanceof HTMLStyleElement) continue
    if (!matches(el.textContent ?? '', want, exact)) continue
    const childHas = [...el.children].some((c) => matches(c.textContent ?? '', want, exact))
    if (!childHas) out.push(el)
  }
  return out
}

/** Every visible element that matches, in page order. */
export function findAll(t: Target, doc: Document = document): Element[] {
  let found: Element[]
  if (t.testId) found = [...doc.querySelectorAll(`[data-testid="${esc(t.testId)}"], [data-demo="${esc(t.testId)}"]`)]
  else if (t.label) found = byLabel(doc, t.label, t.exact)
  else if (t.role) {
    const sel = ROLE_SELECTORS[t.role] ?? `[role="${esc(t.role)}"]`
    found = [...doc.querySelectorAll(sel)]
    if (t.name) found = found.filter((el) => matches(accessibleName(el), t.name!, t.exact))
    if (t.text) found = found.filter((el) => matches(el.textContent ?? '', t.text!, t.exact))
  } else if (t.selector) {
    found = [...doc.querySelectorAll(t.selector)]
    if (t.text) found = byText(doc, t.text, t.exact, found)
  } else if (t.text) found = byText(doc, t.text, t.exact)
  else found = []
  return [...new Set(found)].filter((el) => !isOurs(el) && (isVisible(el) || isShownFileField(el)))
}

/** A file field is usually hidden and opened by a button next to it: it counts as on screen when its box is. */
function isShownFileField(el: Element): boolean {
  return el instanceof HTMLInputElement && el.type === 'file' && !!el.parentElement && isVisible(el.parentElement)
}

/** What a person presses to add a file: the field's label, else the visible button beside a hidden field. */
export function fileOpener(el: Element): Element {
  const label = el.closest('label')
  if (label) return label
  if (isVisible(el) || !el.parentElement) return el
  return [...el.parentElement.querySelectorAll('button, [role="button"]')].find(isVisible) ?? el.parentElement
}

export function pick(list: Element[], nth: Target['nth'] = 'first'): Element | null {
  if (!list.length) return null
  if (nth === 'last') return list[list.length - 1] ?? null
  if (typeof nth === 'number') return list[nth] ?? null
  return list[0] ?? null
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(0, ms)))

export class DemoError extends Error {
  code: 'NOT_FOUND' | 'TIMEOUT' | 'BAD_REQUEST' | 'SIGN_IN_FAILED' | 'FAILED'
  constructor(code: DemoError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export function describe(t: Target): string {
  const what =
    t.testId ?? t.label ?? (t.role ? `${t.role}${t.name ? ` "${t.name}"` : ''}` : undefined) ?? t.selector ?? ''
  return norm([what, t.text && !t.role ? `"${t.text}"` : ''].filter(Boolean).join(' ')).slice(0, 120)
}

/** Waits until the target is on screen (default 10 s). */
export async function waitForTarget(t: Target, timeoutMs = 10_000, doc: Document = document): Promise<Element> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const el = pick(findAll(t, doc), t.nth)
    if (el) return el
    if (Date.now() >= end) throw new DemoError('NOT_FOUND', `Not found on the screen: ${describe(t)}`)
    await sleep(100)
  }
}

export async function waitGone(t: Target, timeoutMs = 10_000, doc: Document = document): Promise<void> {
  const end = Date.now() + timeoutMs
  while (pick(findAll(t, doc), t.nth)) {
    if (Date.now() >= end) throw new DemoError('TIMEOUT', `Still on the screen: ${describe(t)}`)
    await sleep(100)
  }
}

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

export function bringIntoView(el: Element) {
  try {
    el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
  } catch {
    /* old engines */
  }
}

// ---- Highlight ring --------------------------------------------------------------------------------------------

const STYLE_ID = 'lemo-demo-style'
const CSS_TEXT = `
[data-lemo-demo-overlay]{position:fixed;pointer-events:none;z-index:2147483646;border-radius:12px;box-sizing:border-box;
 border:3px solid #f2b33d;box-shadow:0 0 0 4px rgb(242 179 61 / .35),0 0 28px 6px rgb(242 179 61 / .55);
 transition:left .25s cubic-bezier(.22,1,.36,1),top .25s cubic-bezier(.22,1,.36,1),width .25s,height .25s,opacity .2s;
 animation:lemo-demo-pulse 1.1s ease-in-out infinite}
[data-lemo-demo-overlay][data-press]{animation:lemo-demo-press .35s ease-out 1}
[data-lemo-demo-overlay] span{position:absolute;left:50%;bottom:calc(100% + 10px);transform:translateX(-50%);width:max-content;max-width:min(340px,86vw);
 text-align:center;background:#0b2219;color:#fff;font:600 14px/1.35 system-ui,sans-serif;padding:8px 12px;border-radius:12px;box-shadow:0 8px 22px rgb(0 0 0 / .35);
 animation:lemo-demo-cap .35s cubic-bezier(.22,1,.36,1) both}
[data-lemo-demo-overlay][data-below] span{bottom:auto;top:calc(100% + 10px)}
@keyframes lemo-demo-cap{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes lemo-demo-pulse{0%,100%{box-shadow:0 0 0 4px rgb(242 179 61 / .35),0 0 22px 4px rgb(242 179 61 / .45)}50%{box-shadow:0 0 0 10px rgb(242 179 61 / .12),0 0 36px 10px rgb(242 179 61 / .6)}}
@keyframes lemo-demo-press{0%{transform:scale(1)}40%{transform:scale(.92)}100%{transform:scale(1)}}
@media (prefers-reduced-motion:reduce){[data-lemo-demo-overlay]{animation:none;transition:none}}`

let ring: { el: HTMLDivElement; target: Element; raf: number; timer: number } | null = null

const nextFrame = (f: () => void): number =>
  typeof requestAnimationFrame === 'function' ? requestAnimationFrame(f) : window.setTimeout(f, 16)
const cancelFrame = (n: number) =>
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(n) : clearTimeout(n)

export function clearHighlight() {
  if (!ring) return
  cancelFrame(ring.raf)
  clearTimeout(ring.timer)
  ring.el.remove()
  ring = null
}

/** Draws a glowing, pulsing ring around the element (with an optional caption) for `ms`, or until cleared when ms is 0. */
export function highlight(target: Element, ms = 1200, label?: string, doc: Document = document): HTMLDivElement {
  clearHighlight()
  if (!doc.getElementById(STYLE_ID)) {
    const s = doc.createElement('style')
    s.id = STYLE_ID
    s.textContent = CSS_TEXT
    doc.head.appendChild(s)
  }
  const el = doc.createElement('div')
  el.setAttribute('data-lemo-demo-overlay', '')
  el.setAttribute('aria-hidden', 'true')
  if (label) {
    const cap = doc.createElement('span')
    cap.textContent = label.slice(0, 280)
    el.appendChild(cap)
  }
  doc.body.appendChild(el)
  const place = () => {
    const r = target.getBoundingClientRect()
    const pad = 6
    el.style.left = `${r.left - pad}px`
    el.style.top = `${r.top - pad}px`
    el.style.width = `${r.width + pad * 2}px`
    el.style.height = `${r.height + pad * 2}px`
    // Caption below the ring when there is no room above it.
    if (r.top < 90) el.setAttribute('data-below', '')
    else el.removeAttribute('data-below')
    if (ring) ring.raf = nextFrame(place)
  }
  ring = { el, target, raf: 0, timer: 0 }
  place()
  if (ms > 0) ring.timer = window.setTimeout(clearHighlight, ms)
  return el
}

export const currentHighlight = () => ring?.el ?? null

// ---- Actions --------------------------------------------------------------------------------------------------

function mouse(el: Element, type: string) {
  const r = el.getBoundingClientRect()
  const init = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: r.left + r.width / 2,
    clientY: r.top + r.height / 2,
    button: 0,
  }
  const Ctor = type.startsWith('pointer') && typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent
  el.dispatchEvent(
    new Ctor(type, type.startsWith('pointer') ? { ...init, pointerType: 'mouse', isPrimary: true } : init),
  )
}

/** Draws a short made-up signature across a drawing pad, as a finger would (pointer down, moves, up). */
function scribble(el: Element) {
  const r = el.getBoundingClientRect()
  const at = (fx: number, fy: number) => ({ clientX: r.left + r.width * fx, clientY: r.top + r.height * fy })
  const base = { bubbles: true, cancelable: true, composed: true, button: 0, pointerId: 1, pointerType: 'pen', isPrimary: true }
  const Ctor = typeof PointerEvent !== 'undefined' ? PointerEvent : MouseEvent
  const path = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85].map((fx, i) => at(fx, i % 2 ? 0.35 : 0.65))
  el.dispatchEvent(new Ctor('pointerdown', { ...base, ...path[0] }))
  for (const p of path.slice(1)) el.dispatchEvent(new Ctor('pointermove', { ...base, ...p }))
  el.dispatchEvent(new Ctor('pointerup', { ...base, ...path[path.length - 1] }))
}

/** Presses the element the way a mouse does (pointer and mouse events, focus, then click). A drawing pad gets a signature. */
export function press(el: Element) {
  if (ring && ring.target === el) {
    ring.el.setAttribute('data-press', '')
  }
  if (el instanceof HTMLCanvasElement) return scribble(el)
  mouse(el, 'pointerdown')
  mouse(el, 'mousedown')
  if (el instanceof HTMLElement) el.focus({ preventScroll: true })
  mouse(el, 'pointerup')
  mouse(el, 'mouseup')
  if (el instanceof HTMLElement) el.click()
  else el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

/** Sets a value so React sees it: through the element's own value setter, then input and change events. */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
  if (setter) setter.call(el, value)
  else el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

/** Types the value in, a few letters at a time over `typeMs` (0 = at once), so the audience sees it appear. */
export async function typeInto(el: Element, value: string, typeMs = 0) {
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement))
    throw new DemoError('BAD_REQUEST', 'This is not a text field')
  el.focus({ preventScroll: true })
  const typable = typeMs > 0 && !['date', 'time', 'number', 'datetime-local', 'month'].includes(el.type)
  if (typable) {
    const steps = Math.min(value.length, 24)
    for (let i = 1; i < steps; i++) {
      setNativeValue(el, value.slice(0, Math.round((value.length * i) / steps)))
      await sleep(typeMs / steps)
    }
  }
  setNativeValue(el, value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
}

/** Chooses an option of a <select> by value, by visible text, or by index. */
export function choose(el: Element, by: { value?: string; option?: string; index?: number }) {
  if (!(el instanceof HTMLSelectElement)) throw new DemoError('BAD_REQUEST', 'This is not a list to choose from')
  const opts = [...el.options]
  const o =
    by.value !== undefined
      ? opts.find((x) => x.value === by.value)
      : by.option !== undefined
        ? (opts.find((x) => norm(x.text) === norm(by.option)) ?? opts.find((x) => matches(x.text, by.option!)))
        : by.index !== undefined
          ? opts[by.index]
          : undefined
  if (!o) throw new DemoError('NOT_FOUND', `No such choice: ${by.option ?? by.value ?? by.index}`)
  setNativeValue(el, o.value)
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return norm(o.text)
}

/** The nearest pressable element around a click, for reporting what a person pressed. */
export function interactive(el: Element | null): Element | null {
  return (
    el?.closest(
      'button, a[href], input, select, textarea, label, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="option"], [role="switch"]',
    ) ?? null
  )
}

export function roleOf(el: Element): string {
  const r = el.getAttribute('role')
  if (r) return r
  const tag = el.tagName.toLowerCase()
  if (tag === 'a') return 'link'
  if (tag === 'select') return 'combobox'
  if (tag === 'textarea') return 'textbox'
  if (tag === 'input') {
    const t = (el as HTMLInputElement).type
    return t === 'checkbox'
      ? 'checkbox'
      : t === 'radio'
        ? 'radio'
        : ['submit', 'button', 'reset'].includes(t)
          ? 'button'
          : 'textbox'
  }
  return tag
}

const MAX_FILE = 2 * 1024 * 1024

/** Puts made-up files into a file field, as if the person had chosen them. */
export function attachFiles(el: Element, files: { name: string; type: string; base64: string }[]) {
  if (!(el instanceof HTMLInputElement) || el.type !== 'file')
    throw new DemoError('BAD_REQUEST', 'This is not a file field')
  if (!Array.isArray(files) || !files.length || files.length > 5)
    throw new DemoError('BAD_REQUEST', 'Between one and five files are needed')
  const dt = new DataTransfer()
  for (const f of files) {
    if (typeof f?.base64 !== 'string' || typeof f.name !== 'string' || f.base64.length > (MAX_FILE * 4) / 3 + 4)
      throw new DemoError('BAD_REQUEST', 'A file is missing or too big')
    const bin = atob(f.base64)
    const bytes = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
    dt.items.add(new File([bytes], f.name.slice(0, 120), { type: String(f.type || 'application/octet-stream') }))
  }
  el.files = dt.files
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
}
