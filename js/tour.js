// Guided tours, shared by the NgramReader and the Book Classifier (copied between the two apps; keep both copies the same).
// A tour is data: tours/tours.json. Each stop opens the real app state through the app's own link-opening code, and a small
// card explains the view. While a tour runs, the address carries ?tour=<id>&stop=<n> beside the real state; "Copy link" and
// citations use cleanLink(), without those two.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
// `code` first, so that the asterisk in `\w*` stays; then *italics*
const inline = s => esc(s).split('`').map((p, i) => (i % 2 ? `<code>${p}</code>` : p.replace(/\*([^*]+)\*/g, '<i>$1</i>'))).join('')
export const tourQuery = () => { const q = new URLSearchParams(location.search), t = q.get('tour'); return t ? `?tour=${encodeURIComponent(t)}&stop=${encodeURIComponent(q.get('stop') ?? 1)}` : '' }
export const cleanLink = () => { const u = new URL(location.href); u.searchParams.delete('tour'); u.searchParams.delete('stop'); return u.href }

export function createTours({ open, links = {} }) {
  let list = null, tour = null, stop = 0, card = null, moving = false
  const load = async () => (list ??= (await (await fetch('tours/tours.json', { cache: 'no-cache' })).json()).tours)
  const phone = () => innerWidth < 600
  const place = () => { if (!card) return; card.style.left = phone() ? '' : `${document.querySelector('#content').getBoundingClientRect().left + 20}px` }
  // the page scrolls just enough that the card does not cover the caption of the first chart in view
  const clearCaption = () => { if (!card || phone()) return
    const c = card.getBoundingClientRect(), chart = document.querySelector('[data-pane]:not([hidden]) .js-plotly-plot:not([hidden])'); if (!chart) return
    const hit = [...chart.querySelectorAll('.annotation-text')].map(a => a.getBoundingClientRect()).filter(r => r.height && r.top < innerHeight && r.bottom > c.top && r.left < c.right && r.right > c.left)
    if (hit.length) scrollBy(0, Math.max(...hit.map(r => r.bottom)) - c.top + 10) }
  // blinking frames around real elements of the page (the stop's "highlight": a CSS selector, or a list of them, the main one first);
  // the page scrolls so that the first of them is in view and not behind the card
  const spot = sel => { document.querySelectorAll('.tour-spot').forEach(e => e.classList.remove('tour-spot'))
    const els = [].concat(sel ?? []).flatMap(s => [...document.querySelectorAll(s)]); els.forEach(e => e.classList.add('tour-spot')); const el = els[0]; if (!el || !card) return
    const room = phone() ? card.getBoundingClientRect().top : innerHeight, tall = el.getBoundingClientRect().height > room * 0.6
    if (phone()) el.scrollIntoView({ block: tall ? 'start' : 'center', inline: 'nearest' })
    else if (el.getBoundingClientRect().top > innerHeight * 0.6) scrollBy(0, el.getBoundingClientRect().top - innerHeight * 0.35)
    else if (!tall) { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); const r = el.getBoundingClientRect(), c = card.getBoundingClientRect(); if (r.bottom > c.top - 8 && r.top < c.bottom && r.left < c.right && r.right > c.left) scrollBy(0, r.bottom - c.top + 14) } }
  const paint = () => { const s = tour.stops[stop], n = tour.stops.length, last = stop === n - 1, more = s.continue
    card.innerHTML = `<button type="button" class="tour-x" aria-label="Close the tour" title="Close the tour (Esc)">×</button>${last ? '' : '<button type="button" class="tour-skip">Skip the tour</button>'}
      <p class="tour-name">${inline(tour.title)}</p><h3>${inline(s.title)}</h3>
      <div class="tour-text">${s.text.split('\n').map(p => `<p>${inline(p)}</p>`).join('')}</div>
      ${more ? `<p class="tour-more"><a href="${esc(`${links[more.app]}?tour=${encodeURIComponent(more.tour)}&stop=1`)}" target="_blank" rel="noopener">${inline(more.label)}</a></p>` : ''}
      <div class="tour-foot"><button type="button" data-go="-1" ${stop ? '' : 'disabled'}>‹ Back</button><span class="tour-dots" aria-hidden="true">${tour.stops.map((_, i) => `<i class="${i === stop ? 'on' : ''}"></i>`).join('')}</span><span class="tour-n">${stop + 1} of ${n}</span><button type="button" data-go="1" class="primary">${last ? 'Close' : 'Next ›'}</button></div>`
    card.querySelector('.tour-x').onclick = close; if (!last) card.querySelector('.tour-skip').onclick = close
    card.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => step(Number(b.dataset.go)) }) }
  async function go(n) {
    if (moving) return; moving = true; stop = n; paint(); spot(null); card.setAttribute('aria-busy', 'true')
    const u = new URL(location.href); u.searchParams.set('tour', tour.id); u.searchParams.set('stop', n + 1); history.replaceState(null, '', u)
    try { scrollTo(0, 0); await open(tour.stops[n].state); place(); await new Promise(r => setTimeout(r, 60)); spot(tour.stops[n].highlight); clearCaption() } finally { moving = false; card?.removeAttribute('aria-busy') }
  }
  const step = d => { if (moving) return; const n = stop + d; if (n >= tour.stops.length) return close(); if (n >= 0) go(n) }
  const key = e => { if (document.querySelector('dialog[open]') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
    if (e.key === 'ArrowRight') step(1); else if (e.key === 'ArrowLeft') step(-1); else if (e.key === 'Escape') close() }
  function close() { spot(null); card?.remove(); card = null; tour = null; document.body.classList.remove('touring'); removeEventListener('keydown', key); removeEventListener('resize', place); history.replaceState(null, '', cleanLink()) }
  async function start(id, n = 1) {
    let found; try { found = (await load()).find(t => t.id === id) } catch (e) { console.warn('tours not loaded:', e) }
    if (!found) { history.replaceState(null, '', cleanLink()); return false }
    if (!card) { card = document.body.appendChild(Object.assign(document.createElement('aside'), { id: 'tour-card' })); card.setAttribute('aria-label', 'Guided tour'); addEventListener('keydown', key); addEventListener('resize', place) }
    tour = found; document.body.classList.add('touring'); place()
    await go(Math.min(Math.max(n, 1), found.stops.length) - 1); return true
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-tour]'); if (!b) return; e.preventDefault(); b.closest('dialog')?.close(); start(b.dataset.tour) })
  new ResizeObserver(place).observe(document.body)
  return { start, active: () => !!tour }
}
