// Shared interface pieces (both apps; keep both copies the same): foldable panel, tabs, dialogs, copy, toast.
import { FORMATS, unlit } from './cite.js'
import { setFontDelta } from './chartkit.js'
const $ = s => document.querySelector(s)
const phone = () => innerWidth < 600

export function panel({ onResize }) {
  const body = document.body
  const fold = on => { body.classList.toggle('folded', on); if (phone()) body.classList.toggle('drawer-open', !on); onResize?.() }
  $('#hide-panel').onclick = () => fold(true)
  $('#show-panel').onclick = () => fold(false)
  document.querySelectorAll('[data-open-panel]').forEach(b => b.onclick = () => fold(false))
  if (phone()) body.classList.add('folded')
  return { fold, autoFold: () => { if (innerWidth < 900) fold(true) } }
}

// tabs: [{ id, label, soon }]; enabled(id), onChange(id)
export function tabs(host, list, onChange) {
  host.innerHTML = list.map(t => `<button type="button" role="tab" data-tab="${t.id}"${t.soon ? ' disabled class="soon"' : ''}>${t.label}</button>`).join('')
  const api = { active: list[0].id,
    set(id, silent) {
      const b = host.querySelector(`[data-tab="${id}"]`); if (!b || b.disabled) id = api.firstEnabled()
      api.active = id
      host.querySelectorAll('[role=tab]').forEach(x => { const on = x.dataset.tab === id; x.setAttribute('aria-selected', on); x.classList.toggle('on', on); if (on) host.scrollLeft = x.offsetLeft - host.offsetLeft - (host.clientWidth - x.offsetWidth) / 2 })   // the active tab stays in view on phones
      document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = p.dataset.pane !== id })
      if (!silent) onChange(id)
    },
    enable(map) { for (const t of list) if (!t.soon) { const b = host.querySelector(`[data-tab="${t.id}"]`); b.disabled = map[t.id] === false; b.title = b.disabled ? 'No data for this view' : '' } },
    firstEnabled() { return host.querySelector('[role=tab]:not(:disabled)')?.dataset.tab ?? list[0].id },
  }
  host.onclick = e => { const b = e.target.closest('[role=tab]'); if (b && !b.disabled) api.set(b.dataset.tab) }
  return api
}

// text size: - and + next to Help, 0.5 pt per step (0.5 pt = 2/3 px), remembered in this browser
export function fontControls(onChange) {
  let step = 0; try { step = Number(localStorage.getItem('openiti-font-step')) || 0 } catch {}
  const apply = () => { const px = step * 2 / 3; document.documentElement.style.setProperty('--fd', `${px}px`); setFontDelta(px); try { localStorage.setItem('openiti-font-step', step) } catch {} }
  const change = d => { step = Math.max(-3, Math.min(8, step + d)); apply(); onChange() }
  $('#font-minus').onclick = () => change(-1); $('#font-plus').onclick = () => change(1); apply()
}

export function toast(text) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true }, 2000) }
export async function copyText(text, done = 'Copied') { try { await navigator.clipboard.writeText(text); toast(done) } catch { toast('Copying is not available here; select the text instead') } }

export function dialogs() { document.querySelectorAll('dialog [data-close]').forEach(b => b.onclick = () => b.closest('dialog').close()); document.querySelectorAll('dialog').forEach(d => d.onclick = e => { if (e.target === d) d.close() }) }

// the citation dialog; get() returns the citation fields for the current view
export function citeDialog(get) {
  const dlg = $('#cite-dialog'), body = dlg.querySelector('.cite-text'), tabsEl = dlg.querySelector('.cite-tabs')
  let fmt = 'chicago'
  tabsEl.innerHTML = Object.entries(FORMATS).map(([k, f]) => `<button type="button" data-fmt="${k}">${f.label}</button>`).join('')
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  const draw = () => {
    const f = FORMATS[fmt], text = f.make(get()); dlg.dataset.text = unlit(text.replace(/\*/g, f.html ? '' : '*'))
    body.innerHTML = f.html ? unlit(esc(text).replace(/\*([^*]+)\*/g, '<i>$1</i>')) : `<pre>${esc(text)}</pre>`
    tabsEl.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.fmt === fmt))
  }
  tabsEl.onclick = e => { const b = e.target.closest('[data-fmt]'); if (b) { fmt = b.dataset.fmt; draw() } }
  dlg.querySelector('.cite-copy').onclick = () => copyText(dlg.dataset.text, 'Citation copied')
  return { open() { draw(); dlg.showModal() }, text: f => unlit(FORMATS[f].make(get()).replace(/\*/g, '')) }
}
