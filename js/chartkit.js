// Shared chart kit of the NgramReader and the Book Classifier (copied between the two apps; keep both copies the same):
// one style (palette with a dash pattern per line, fonts, gridlines), captions INSIDE the chart (title, subtitle, footer
// line, on screen and in every export), exports as SVG/PNG in three sizes.
import { LIBS } from './config.js'

let plotlyPromise
export const loadPlotly = () => (plotlyPromise ??= new Promise((resolve, reject) => {
  if (window.Plotly) return resolve(window.Plotly)
  const s = document.createElement('script'); s.src = LIBS.plotly; s.onload = () => resolve(window.Plotly); s.onerror = reject
  document.head.appendChild(s)
}))

// colorblind-safe palette (Okabe-Ito hues, darkened for white paper); each colour has its own dash pattern
export const STYLES = [
  { color: '#1f5f99', dash: 'solid', rgb: '31,95,153' },
  { color: '#b8560f', dash: 'dash', rgb: '184,86,15' },
  { color: '#00806a', dash: 'dot', rgb: '0,128,106' },
  { color: '#8a3f87', dash: 'dashdot', rgb: '138,63,135' },
  { color: '#a58a00', dash: 'longdash', rgb: '165,138,0' },
  { color: '#3f93c9', dash: 'longdashdot', rgb: '63,147,201' },
  { color: '#c0392b', dash: '10px,3px,2px,3px,2px,3px', rgb: '192,57,43' },
  { color: '#333333', dash: '2px,6px', rgb: '51,51,51' },
]
export const styleOf = i => STYLES[i % STYLES.length]
export const INK = '#1b1b1b', MUTED = '#5a5a5a', GRID = '#e6e6e6', AXIS = '#9a9a9a'
export const FONT = "Brill, 'Noto Serif', serif"
const SIZE = { title: 16, sub: 12.5, foot: 10, base: 13 }

// export sizes: k scales all text; "Paper" text stays readable when the 1000 px image is printed 8-9 cm wide
export const PRESETS = {
  slide: { label: 'Slide (16:9)', width: 1600, height: 900, k: 1.5 },
  paper: { label: 'Paper (single column)', width: 1000, height: 1000, k: 2.1 },
  screen: { label: 'As on screen', k: 1 },
}
export const narrow = () => innerWidth < 600

// Arabic inside a caption: marked here, set in Amiri when the caption is laid out (spaces stay, so a form never breaks)
export const arabic = s => `\uE000${s.replace(/ /g, '\u00A0')}\uE001`
const arabicSpans = (t, px) => t.replace(/\uE000/g, `<span style="font-family:Amiri,'Geeza Pro',serif;font-size:${px}px">`).replace(/\uE001/g, '</span>')

// wrap a line (may contain <i>…</i>, <b>…</b>) to at most n visible characters per line; an open <i> is closed and reopened
function wrap(line, n) {
  const out = []; let cur = '', len = 0, open = false
  const words = line.split(' ').flatMap(w => (w.length > n ? w.match(new RegExp(`.{1,${n}}`, 'g')) : [w]))   // long links are cut
  for (const w of words) {
    const vis = w.replace(/<\/?[ib]>|[\uE000\uE001]/g, '').length
    if (len && len + 1 + vis > n) { out.push(cur + (open ? '</i>' : '')); cur = open ? '<i>' : ''; len = 0 }
    cur += (len ? ' ' : '') + w; len += (len ? 1 : 0) + vis
    const o = (w.match(/<i>/g) ?? []).length, c = (w.match(/<\/i>/g) ?? []).length; if (o !== c) open = o > c
  }
  if (cur) out.push(cur); return out
}
const scaleFonts = (o, k, d = 0) => {   // every font/tickfont size in a layout, recursively
  if (Array.isArray(o)) return o.map(x => scaleFonts(x, k, d))
  if (o && typeof o === 'object') { const r = {}; for (const [a, b] of Object.entries(o)) r[a] = a === 'size' && typeof b === 'number' ? (b + d) * k : scaleFonts(b, k, d); return r }
  return o
}

// the layout with style and caption ({ title, subtitle: [...], note, footer }) for a width; base = the chart's own layout (margin = room for its axes)
function styled(base, cap, { width, k = 1, d = 0 }) {
  const m = { t: 8, r: 16, b: 44, l: 56, ...(base.margin ?? {}) }
  const titleSize = (SIZE.title + d) * k, subSize = (SIZE.sub + d) * k, footSize = (SIZE.foot + d) * k
  const perLine = (px, f) => Math.max(24, Math.floor((width - 16) / (px * f)))
  const title = wrap(cap.title, perLine(titleSize, 0.52)).map(l => `<b>${l}</b>`)
  const sub = (cap.subtitle ?? []).flatMap(l => wrap(l, perLine(subSize, 0.47))).map(l => `<span style="font-size:${subSize}px;color:${MUTED}">${l}</span>`)
  const foot = [...wrap(cap.note ? `<b>Note:</b> ${cap.note}` : '', perLine(footSize, 0.47)), ...wrap(cap.footer ?? '', perLine(footSize, 0.47))]
  const lines = title.length + sub.length + (base.subRoom ?? 0)     // subRoom: a line kept free for a label drawn by the chart itself
  const legendRoom = (base.legendRoom === true ? 1 : base.legendRoom || 0) * 26 * k   // rows of a legend above the plot
  const top = Math.ceil(lines * 1.3 * titleSize + 10 * k + legendRoom) + m.t * k, bottomAxes = m.b * k, footH = Math.ceil(foot.length * 1.3 * footSize + 8 * k)
  const L = scaleFonts({ ...base, margin: undefined, annotations: undefined }, k, d)
  const left = m.l * k, note = { showarrow: false, xref: 'paper', yref: 'paper', x: 0, xanchor: 'left', align: 'left', xshift: -left + 8 }
  return { ...L, autosize: false, paper_bgcolor: '#ffffff', plot_bgcolor: '#ffffff', font: { family: FONT, size: (SIZE.base + d) * k, color: INK },
    margin: { t: top, r: m.r * k, b: bottomAxes + footH, l: left, pad: 0 },
    annotations: [...scaleFonts(base.annotations ?? [], k, d).map(a => ({ ...a, xshift: (a.xshift ?? 0) * k, yshift: (a.yshift ?? 0) * k, text: arabicSpans(a.text, (15 + d) * k) })),
      { ...note, text: arabicSpans([...title, ...sub].join('<br>'), subSize * 1.2), y: 1, yanchor: 'top', yshift: top - 4, font: { family: FONT, size: titleSize, color: INK } },
      { ...note, text: foot.join('<br>'), y: 0, yanchor: 'top', yshift: -bottomAxes, font: { family: FONT, size: footSize, color: MUTED } }],
  }
}

// height of a figure whose plot area is fixed: layout.plotHeight (px), or layout.aspect (plot height / plot width; aspectScale
// for stacked panels); the caption and axes come on top of that, so the proportion holds for the plot itself
function figureHeight(layout, caption, width, k = 1, d = 0) {
  if (!layout.aspect && !layout.plotHeight) return null
  const m = styled({ ...layout, height: 500 }, caption, { width, k, d }).margin
  const plotH = layout.plotHeight ? layout.plotHeight * k : Math.max((width - m.l - m.r) * layout.aspect, 220 * k)
  return Math.round(m.t + m.b + plotH * (layout.aspectScale ?? 1))
}

// the reader's text size (the - and + buttons), in px; on screen only, exports keep their fixed sizes
let fontDelta = 0
export const setFontDelta = d => { fontDelta = d }

const config = { responsive: false, displaylogo: false, modeBarButtonsToRemove: ['toImage', 'lasso2d', 'select2d'] }

// draw traces with layout and caption into el and remember them for exports
export async function plot(el, traces, layout, caption, filename) {
  const Plotly = await loadPlotly()
  el._kit = { traces, layout, caption, filename }
  const width = el.clientWidth || 800, fixed = figureHeight(layout, caption, width, 1, fontDelta), height = fixed ?? layout.height ?? (el.clientHeight || 500)
  if (fixed) el.style.height = `${fixed}px`
  await Plotly.react(el, traces, { ...styled({ ...layout, height }, caption, { width, d: fontDelta }), width, height }, config)
}
export async function redraw(el) { if (el?._kit) { const { traces, layout, caption, filename } = el._kit; await plot(el, traces, layout, caption, filename) } }
export async function setShapes(el, shapes) { const Plotly = await loadPlotly(); el._kit.layout = { ...el._kit.layout, shapes }; await Plotly.relayout(el, { shapes }) }

// an image of the chart at a preset: the caption is laid out again and all text scaled for that size
export async function chartImage(el, format, presetName) {
  const Plotly = await loadPlotly(); const p = PRESETS[presetName] ?? PRESETS.screen
  const width = p.width ?? el.offsetWidth, own = el._kit.layout, patch = own.exportPatch?.[presetName]
  const base = patch ? { ...own, xaxis: { ...own.xaxis, ...patch.xaxis } } : own     // per-preset axis changes (e.g. fewer labels)
  const k = p.k, height = !p.height ? el.offsetHeight : base.exportHeight?.[presetName] ?? (presetName === 'slide' ? p.height : figureHeight(base, el._kit.caption, width, k) ?? p.height)
  const traces = el._kit.traces.map(t => (t.line?.width && k !== 1 ? { ...t, line: { ...t.line, width: t.line.width * k } } : t))
  const L = { ...styled({ ...base, height, fixed: true }, el._kit.caption, { width, k }), width, height, autosize: false }
  const url = await Plotly.toImage({ data: traces, layout: L, config: { displayModeBar: false } }, { format, width, height, scale: format === 'png' && presetName === 'screen' ? 2 : 1 })
  return { url, width, height }
}
export async function saveChart(el, format, presetName) {
  const { url, width, height } = await chartImage(el, format, presetName)
  const a = document.createElement('a'); a.href = url; a.download = `${el._kit.filename}_${presetName}.${format}`
  document.body.appendChild(a); a.click(); a.remove()
  return { width, height }
}

// toolbar for a chart: export size, SVG, PNG, TSV
export function exportBar(host, charts, tsv) {
  host.innerHTML = `<label class="xsize">Export size <select>${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}">${p.label}</option>`).join('')}</select></label>
    <button type="button" data-f="svg">SVG</button><button type="button" data-f="png">PNG</button>${tsv ? '<button type="button" data-f="tsv">TSV</button>' : ''}`
  const sel = host.querySelector('select')
  host.querySelectorAll('[data-f]').forEach(b => b.onclick = async () => {
    if (b.dataset.f === 'tsv') return tsv()
    for (const el of charts()) await saveChart(el, b.dataset.f, sel.value)
  })
}
