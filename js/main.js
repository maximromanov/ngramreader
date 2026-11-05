// OpenITI NgramReader, static v1 — page controller.
import { APP, CITATION, RELEASES, DEFAULT_RELEASE, dataBase, dataCommit, classifierURL, resolveRelease } from './config.js'
import { validateLines } from './query.js'
import { readByIds, loadStatic, loadLabels } from './data.js'
import { prepare, compute, relative, PERIODS_PLOT, CENTURIES, compsCompared } from './compute.js'
import { overTimeTogether, overTimeSeparate, radarChart, typesOverTimeChart } from './charts.js'
import { redraw, exportBar, styleOf, arabic, typeBars, narrow, byType } from './chartkit.js'
import { panel, tabs, dialogs, citeDialog, copyText, fontControls } from './ui.js'
import { translitInput } from './translit.js'
import { packState, unpackState } from './share.js'
import { chartCitation } from './cite.js'
import { renderTable, esc, fmt } from './tables.js'
import { decodeState } from './state.js'
import { toTSV, saveText, saveBlob, zipFiles, stamp } from './download.js'

const $ = s => document.querySelector(s)
const ORDER_NAME = ['unigrams', 'bigrams', 'trigrams']
const PAGE = 100
// explicit column order: JavaScript lists integer-like keys ("100", …) before other keys
const CHRONO_TABLE_COLS = ['search', 'perSearch', 'ngram', 'perNgram', 'perNgramRel', ...CENTURIES.map(String)]
// books and authors tables with readable working labels (labels/ in the data repository): added for display and
// download only, the computed tables (S.results) are unchanged. Without a label the URI is shown.
const BOOK_COLS = ['label', 'Book', 'Arabic', 'bookURI', 'URL', 'countTotal', 'countRel', 'tok_length', 'compsFinal', 'compsValue', 'compsPrelim', 'ngramAll']
const AUTHOR_COLS = ['label', 'Author', 'Arabic', 'authorURI', 'countTotal', 'countRel', 'tokTotal', 'ngramAll']
const UNCERTAIN = 'Label uncertain; see URI.'
const withBookLabels = rows => rows.map(r => { const l = S.labels?.books.get(r.bookURI)
  return { ...r, Book: l?.label ?? r.bookURI, Arabic: l?.titleAR || null, labelUncertain: l ? Number(l.ambiguous) : null } })
const withAuthorLabels = rows => rows.map(r => { const l = S.labels?.authors.get(r.authorURI)
  return { ...r, Author: l?.authorName ?? r.authorURI, Arabic: l?.authorAR || null } })
// "*title*" markup -> italics; uncertain labels get a superscript "?"
// the label links to the book's profile in the Book Classifier (new tab); the release text link stays in its own column
const renderBookLabel = (v, r) => `<a href="${classifierURL()}?book=${encodeURIComponent(r.bookURI)}" target="_blank" rel="noopener" title="Book profile in the Book Classifier">${esc(v).replace(/\*([^*]+)\*/g, '<i>$1</i>')}</a>` + (r.labelUncertain ? `<sup class="uncertain" title="${UNCERTAIN}">?</sup>` : '')
const renderAuthorLabel = (v, r) => `<a href="${classifierURL()}?author=${encodeURIComponent(r.authorURI)}" target="_blank" rel="noopener" title="Author profile in the Book Classifier">${esc(v)}</a>`

// ---- state -------------------------------------------------------------------------------------------
const S = {
  release: RELEASES[DEFAULT_RELEASE],
  appCommit: null,
  previews: [],              // per search line: { line (parsed), ids, tr, all, clean, ar: Map, excluded: Set, sort, filter, page }
  order: null,
  rows: new Map(),           // order -> Map(ID -> [{ bookID, count }])
  P: null,                   // prepared static data
  results: null,             // last computed tables
  busy: false,
  view: { value: 'rel', layout: 'together', corpus: false, ratio: '3', tchart: 'bars', tlayout: 'together', tmeasure: 'share' },   // switches of the Over time and Book types tabs
  dirty: new Set(),          // tabs to draw again
}
window.__ngr = S             // exposed for automated tests

// ---- Web Worker (vocabulary) ----------------------------------------------------------------------------
const worker = new Worker(new URL('./vocab-worker.js', import.meta.url), { type: 'module' })
let msgId = 0; const pending = new Map()
worker.onmessage = ({ data }) => {
  const p = pending.get(data.id); if (!p) return
  if (data.progress) { p.onProgress?.(data.progress); return }
  pending.delete(data.id); data.ok ? p.resolve(data) : p.reject(new Error(data.error))
}
const ask = (msg, onProgress) => new Promise((resolve, reject) => { const id = ++msgId; pending.set(id, { resolve, reject, onProgress }); worker.postMessage({ ...msg, id }) })

// ---- UI: search lines --------------------------------------------------------------------------------
function addLine(value = '') {
  const row = document.createElement('div'); row.className = 'line'
  row.innerHTML = `<input type="text" spellcheck="false" autocomplete="off" placeholder="#Label #item1 #item2 …" aria-label="search line">
    <button type="button" class="remove" title="Remove this line" aria-label="Remove this line">×</button>`
  row.querySelector('input').value = value
  row.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') runSearch() })
  translitInput(row.querySelector('input'))
  row.querySelector('.remove').onclick = () => { row.remove(); if (!document.querySelectorAll('#lines .line').length) addLine() }
  $('#lines').appendChild(row)
}
const lineValues = () => [...document.querySelectorAll('#lines input')].map(i => i.value)
const mode = () => document.querySelector('input[name=mode]:checked').value
const span = () => parseFloat($('#span').value)

function message(html, kind = 'error') { $('#messages').innerHTML = html ? `<div class="msg ${kind}">${html}</div>` : '' }
function status(text) { $('#status').textContent = text || ''; $('#status').hidden = !text }

// ---- search ------------------------------------------------------------------------------------------
async function runSearch({ excluded = null } = {}) {
  if (S.busy) return
  message(''); const t0 = performance.now(); S.timing = { start: t0 }
  const { lines, order, errors } = validateLines(lineValues())
  if (errors.length) { message(errors.map(esc).join('<br>')); return }
  S.busy = true; $('#search').disabled = true
  try {
    const base = dataBase(S.release)
    status(`Data is being downloaded. This needs to be done only once. (${ORDER_NAME[order - 1]} vocabulary)`)
    const load = await ask({ cmd: 'load', order, base, format: S.release.vocabFormat },
      p => status(`Data is being downloaded. This needs to be done only once. (${ORDER_NAME[order - 1]}: ${(p.bytes / 1e6).toFixed(1)} MB)`))
    S.timing.vocab = performance.now() - t0; S.timing.vocabStats = load.stats
    status('Searching the vocabulary…')
    const matches = []
    for (const l of lines) matches.push(await ask({ cmd: 'match', order, regex: l.regex }))
    S.timing.regex = matches.reduce((s, m) => s + m.ms, 0)
    const empty = lines.filter((l, i) => matches[i].ids.length === 0)
    if (empty.length === lines.length) {
      message(`No ${ORDER_NAME[order - 1]} match ${lines.length > 1 ? 'these searches' : 'this search'}. Check the simplified Buckwalter transliteration (e.g. bgdAd for بغداد; Arabic letters are converted automatically), use "_" between the words of bigrams and trigrams (e.g. ktb_Alyh), and check the regular expression.`)
      hideResults(); renderPreviews([]); return
    }
    if (empty.length) message(empty.map(l => `Line ${l.index + 1} (${esc(l.line)}) matches no ${ORDER_NAME[order - 1]}; it is left out of the results.`).join('<br>'), 'warn')
    status('Fetching Arabic script of the matched forms…')
    const allIds = [...new Set(matches.flatMap(m => m.ids))]
    const arRows = await readByIds(`${base}data/data_${order}grams2up_HI_AR/`, allIds, ['ID', 'ngram'])
    const ar = new Map(arRows.map(r => [r.ID, r.ngram]))
    S.order = order
    S.previews = lines.map((l, i) => matches[i].ids.length ? {
      line: l, ids: matches[i].ids, tr: matches[i].tr, all: matches[i].all, clean: matches[i].clean, ar,
      excluded: new Set(excluded?.[l.index] ?? []), sort: 'count', filter: '', page: 0 } : null).filter(Boolean)
    renderPreviews(S.previews)
    S.timing.preview = performance.now() - t0
    await computeAndRender()
    S.timing.done = performance.now() - t0
    if (S.results) UI.autoFold()
  } catch (e) {
    console.error(e); message(`Something went wrong: ${esc(e.message)}. Please try again; if it persists, report it with the page address.`)
  } finally { S.busy = false; $('#search').disabled = false; status('') }
}

async function computeAndRender() {
  const base = dataBase(S.release)
  if (!S.P) {
    status('Loading book metadata…')
    const st = await loadStatic(base); st.release = S.release.release
    S.P = prepare(st)
  }
  const lines = S.previews.map(p => ({ label: p.line.label, userLabel: p.line.userLabel, regex: p.line.regex, index: p.line.index,
    ids: p.ids.filter(id => !p.excluded.has(id)) }))
  const ticked = [...new Set(lines.flatMap(l => l.ids))]
  if (!ticked.length) { message('No forms are ticked. Tick at least one form in the match lists.'); hideResults(); return }
  if (!S.rows.has(S.order)) S.rows.set(S.order, new Map())
  const cache = S.rows.get(S.order)
  const need = ticked.filter(id => !cache.has(id))
  if (need.length) {
    status(`Fetching per-book counts for ${need.length.toLocaleString('en')} forms…`)
    const rows = await readByIds(`${base}data_additional/ngrams_per_book/books_${S.order}gram/`, need, ['ID', 'bookID', 'count'],
      (k, n) => status(`Fetching per-book counts: ${k} of ${n} data blocks…`))
    for (const id of need) cache.set(id, [])
    for (const r of rows) cache.get(r.ID).push({ bookID: r.bookID, count: r.count })
  }
  const tr = new Map(), arabic = new Map()
  for (const p of S.previews) p.ids.forEach((id, k) => { tr.set(id, p.tr[k]); arabic.set(id, p.ar.get(id)) })
  status('Computing results…')
  const R = compute(lines, cache, arabic, tr, S.P, mode())
  S.results = R ? { ...R, lines, mode: mode(), span: span(), relative: relative(R.chronoGraph, S.P, mode()) } : null
  await updateURL()
  if (!R) { message('The ticked forms occur only in texts outside the selected corpus. Choose "keep all texts (100%)" to include them.'); hideResults(); return }
  await renderResults()
  $('#update').hidden = true
}

// ---- match preview ---------------------------------------------------------------------------------------
function renderPreviews(previews) {
  const box = $('#preview'); box.innerHTML = ''
  box.hidden = !previews.length
  previews.forEach((p, k) => {
    const el = document.createElement('details'); el.className = 'pv'; el.open = true
    box.appendChild(el); drawPreview(el, p)
  })
}
function drawPreview(el, p) {
  const m = mode()
  const idx = p.ids.map((_, k) => k)
  const f = p.filter.trim()
  let rows = f ? idx.filter(k => p.tr[k].includes(f) || (p.ar.get(p.ids[k]) ?? '').includes(f)) : idx
  const cnt = k => (m === 'all' ? p.all[k] : p.clean[k])
  rows.sort(p.sort === 'count' ? (a, b) => cnt(b) - cnt(a) || p.ids[a] - p.ids[b] : p.sort === 'alpha' ? (a, b) => (p.tr[a] < p.tr[b] ? -1 : 1) : (a, b) => (p.ar.get(p.ids[a]) ?? '').localeCompare(p.ar.get(p.ids[b]) ?? '', 'ar'))
  const pages = Math.max(1, Math.ceil(rows.length / PAGE)); p.page = Math.min(p.page, pages - 1)
  const ticked = p.ids.length - p.excluded.size
  const open = el.open
  el.innerHTML = `<summary><b>${esc(p.line.userLabel || `Line ${p.line.index + 1}`)}</b> — ${p.ids.length.toLocaleString('en')} form${p.ids.length > 1 ? 's' : ''} found, <span class="ticked">${ticked.toLocaleString('en')} ticked</span> <code>${esc(p.line.regex)}</code></summary>
    <div class="pv-tools">
      <input type="search" placeholder="filter forms (Buckwalter or Arabic)" value="${esc(p.filter)}" aria-label="filter forms">
      <select aria-label="sort forms"><option value="count">sort: corpus count</option><option value="alpha">sort: transliteration</option><option value="arabic">sort: Arabic</option></select>
      <button type="button" data-a="all">tick all${f ? ' shown' : ''}</button><button type="button" data-a="none">untick all${f ? ' shown' : ''}</button>
    </div>
    <table class="pv-list"><thead><tr><th></th><th>form</th><th>Arabic</th><th class="num" title="${m === 'all' ? 'Count in all texts' : 'Count in clean texts (~95%)'}">${m === 'all' ? 'N' : 'N*'}</th></tr></thead><tbody>
    ${rows.slice(p.page * PAGE, (p.page + 1) * PAGE).map(k => `<tr><td><input type="checkbox" data-id="${p.ids[k]}" ${p.excluded.has(p.ids[k]) ? '' : 'checked'} aria-label="tick ${esc(p.tr[k])}"></td>
      <td><code>${esc(p.tr[k])}</code></td><td dir="rtl" lang="ar">${esc(p.ar.get(p.ids[k]) ?? '')}</td><td class="num">${cnt(k).toLocaleString('en')}</td></tr>`).join('')}
    </tbody></table>
    <div class="pager"><button data-p="prev" ${p.page === 0 ? 'disabled' : ''}>‹</button> <span>${rows.length ? p.page * PAGE + 1 : 0}–${Math.min((p.page + 1) * PAGE, rows.length)} of ${rows.length.toLocaleString('en')}${f ? ' (filtered)' : ''}</span> <button data-p="next" ${p.page >= pages - 1 ? 'disabled' : ''}>›</button> <span class="pv-key">${m === 'all' ? 'N: all texts' : 'N*: clean texts'}</span></div>`
  el.open = open
  const filt = el.querySelector('input[type=search]')
  filt.oninput = () => { p.filter = filt.value; p.page = 0; drawPreview(el, p); const n = el.querySelector('input[type=search]'); n.focus(); n.setSelectionRange(n.value.length, n.value.length) }
  const sel = el.querySelector('select'); sel.value = p.sort; sel.onchange = () => { p.sort = sel.value; p.page = 0; drawPreview(el, p) }
  el.querySelector('[data-a=all]').onclick = () => { rows.forEach(k => p.excluded.delete(p.ids[k])); drawPreview(el, p); changed() }
  el.querySelector('[data-a=none]').onclick = () => { rows.forEach(k => p.excluded.add(p.ids[k])); drawPreview(el, p); changed() }
  el.querySelectorAll('input[type=checkbox]').forEach(cb => cb.onchange = () => { const id = +cb.dataset.id; cb.checked ? p.excluded.delete(id) : p.excluded.add(id); drawPreview(el, p); changed() })
  el.querySelector('[data-p=prev]').onclick = () => { p.page--; drawPreview(el, p) }
  el.querySelector('[data-p=next]').onclick = () => { p.page++; drawPreview(el, p) }
}
function changed() { $('#update').hidden = false }

// ---- results -------------------------------------------------------------------------------------------
function hideResults() {
  S.results = null; $('#empty').hidden = false; document.querySelectorAll('[data-pane]').forEach(p => { p.hidden = true })
  for (const id of ['cite', 'copy-link', 'download-all']) $('#' + id).disabled = true
  $('#chips').innerHTML = '<span class="note">No results.</span>'; T.enable(Object.fromEntries(TAB_LIST.map(t => [t.id, false])))
}
function fileStem() { return `NgramReader_${S.results.lines.map(l => l.userLabel.replace(/[^\p{L}\p{N}]+/gu, '')).join('-').slice(0, 40) || 'search'}_${S.results.mode}` }

// ---- captions: what a chart shows, written into the chart itself --------------------------------------------------
const today = () => new Date().toISOString().slice(0, 10)
const modeText = m => (m === 'all' ? 'All texts (100%)' : 'Texts without problematic ones (~95%)')
const formsOf = l => { const p = S.previews.find(x => x.line.index === l.index); return { p, forms: l.ids.map(id => p.tr[p.ids.indexOf(id)]) } }
const typed = r => r.replace(/^\\b\(/, '').replace(/\)\\b$/, '')   // the search as typed, without the \\b(…)\\b the app adds
const shortForms = (forms, sep = ', ') => (forms.length > 4 ? `${forms.slice(0, 4).join(sep)} and ${(forms.length - 4).toLocaleString('en')} more` : forms.join(sep))
// regex as typed; the found forms in Arabic script (first few; the full list is in the TSV and the zip README)
const lineDetail = l => { const { p, forms } = formsOf(l), ar = l.ids.map((id, i) => (p.ar.get(id) ? arabic(p.ar.get(id)) : forms[i]))
  return `${typed(l.regex)} · ${forms.length.toLocaleString('en')} of ${p.ids.length.toLocaleString('en')} forms: ${shortForms(ar, `${arabic('،')} `)}` }
const labelIt = l => `<i>${esc(l.userLabel)}</i>`
function searchCaption(R) {
  const shown = R.lines.slice(0, 6).map(l => `${labelIt(l)}: ${lineDetail(l)}`)
  if (R.lines.length > 6) shown.push(`and ${R.lines.length - 6} more lines (all in the TSV and the zip README)`)
  return shown
}
const corpusLine = R => `${modeText(R.mode)}: ${S.P.modes[R.mode].nBooks.toLocaleString('en')} texts, ${S.P.modes[R.mode].tokens.toLocaleString('en')} tokens. 25-year periods by the author's death date.`
const footer = () => chartCitation(citation(), dataCommit(S.release).slice(0, 7))

function renderChips(R) {
  $('#chips').innerHTML = R.lines.map(l => { const { p, forms } = formsOf(l), st = styleOf(l.index)
    const dash = { solid: '', dash: '7 4', dot: '2 3', dashdot: '7 3 2 3', longdash: '12 4', longdashdot: '12 4 2 4' }[st.dash] ?? st.dash.replace(/px/g, '').replace(/,/g, ' ')
    return `<button type="button" class="chip" data-line="${l.index}" title="Show this line in the panel"><svg width="26" height="8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="${st.color}" stroke-width="2.5" stroke-dasharray="${dash}"/></svg><b>${esc(l.userLabel)}</b> <code>${esc(typed(l.regex))}</code> <span>${forms.length.toLocaleString('en')} of ${p.ids.length.toLocaleString('en')} forms</span></button>` }).join('')
    + `<span class="meta">${R.mode === 'all' ? 'All texts' : 'Clean texts (~95%)'} · OpenITI ${S.release.release}</span>`
  $('#chips').querySelectorAll('.chip').forEach(c => c.onclick = () => { UI.fold(false); const k = S.previews.findIndex(p => p.line.index === +c.dataset.line); const d = document.querySelectorAll('#preview details')[k]; if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }) } })
}

async function renderResults() {
  const R = S.results; $('#empty').hidden = true
  for (const id of ['cite', 'copy-link', 'download-all']) $('#' + id).disabled = false
  const hasTypes = R.compsTotalGraph.some(r => r.ngramCount > 0)
  T.enable({ time: true, types: hasTypes, typestime: hasTypes, century: R.chronoTable.length > 0, books: R.booksTable.length > 0, authors: R.authorsTable.length > 0 })
  renderChips(R)
  S.dirty = new Set(TAB_LIST.map(t => t.id))
  try { S.labels = await loadLabels(dataBase(S.release)) } catch (e) { S.labels = null; console.warn('labels not loaded:', e) }
  T.set(T.active, true)
  await drawTab(T.active)
}

const aspect = () => (S.view.ratio === '2' ? 1 / 2 : 1 / 3)   // plot height / width
async function drawTime() {
  const R = S.results, V = S.view, el = $('#chart-time'), stem = fileStem()
  const series = R.chronoGraph.map(g => { const l = R.lines.find(x => x.label === g.label); return { label: g.label, index: l.index, userLabel: l.userLabel, values: PERIODS_PLOT.map(p => g[p]) } })
  const rel = R.relative.map(r => { const l = R.lines.find(x => x.label === r.label); return { ...r, index: l.index, userLabel: l.userLabel } })
  const tokens = PERIODS_PLOT.map(p => S.P.modes[R.mode].periodTokens.get(p) ?? 0), corpus = V.corpus ? tokens : null
  const smooth = R.span <= 0.1 ? 'no smoothing' : `LOESS smoothing, span ${R.span}`
  const bars = V.corpus ? ` Grey bars: corpus size per period (largest ${Math.max(...tokens).toLocaleString('en')} tokens).` : ''
  const separate = V.layout === 'separate'
  $('#sw-value').classList.toggle('off', separate)
  const relative = V.value === 'rel'
  const caption = { title: separate ? 'Absolute counts and relative frequency, by search line' : relative ? 'Relative frequency over time' : 'Absolute counts over time',
    subtitle: separate ? [] : searchCaption(R), note: `${corpusLine(R)} ${separate ? `Bars: occurrences per period (left axis); line: relative frequency, ${smooth} (right axis); each panel has its own scale.` : relative ? `Occurrences divided by the corpus tokens of the period; ${smooth}.` : `Occurrences per period; ${smooth}.`}${bars}`, footer: footer() }
  if (separate) {
    const panels = series.map((s, i) => ({ ...s, absolute: s.values, relative: rel[i].values, detail: lineDetail(R.lines.find(x => x.label === s.label)) }))
    await overTimeSeparate(el, panels, { span: R.span, corpus, caption, aspect: aspect(), filename: `${stem}_over_time_separate` })
  } else {
    await overTimeTogether(el, relative ? rel : series, { relative, span: R.span, corpus, caption, aspect: aspect(), filename: `${stem}_${relative ? 'relative' : 'absolute'}` })
  }
}
// Book types: bars (Together or Separate; share of hits, or compared with the corpus) or the classic radar, with a table
const typeCode = t => /^\[(.+?)\]/.exec(t)?.[1] ?? t
const typeName = t => t.replace(/^\[.+?\]\s*/, '')
const comparedRows = R => (R.compared ??= compsCompared(S.P, R.mode, R.compsTotalGraph))
const typeLines = R => R.lines.filter(l => R.compsTotalGraph.some(r => r.label === l.label))
const pct = v => `${(v * 100).toFixed(1)}%`
const FEW_HITS = 20     // Compared with corpus: bars resting on fewer hits are drawn light
const typesOf = rows => [...new Set(rows.map(r => r.compsFinal))].sort(byType)
// table shading: the colour of the search line, darker for a larger value; each line on its own scale
const shade = (v, max, l) => (v > 0 && max > 0 ? `background:rgba(${styleOf(l.index).rgb},${(0.62 * Math.sqrt(v / max)).toFixed(3)})` : '')
async function drawTypes() {
  const R = S.results, V = S.view, stem = fileStem(), radar = V.tchart === 'radar', vs = !radar && V.tmeasure === 'corpus', lines = typeLines(R)
  $('#chart-radar').hidden = !radar; $('#chart-typebars').hidden = radar; $('#how-compared').hidden = !vs
  const base = `${corpusLine(R)} Book types from a classifier of the OpenITI texts.`
  if (radar) await radarChart($('#chart-radar'), R.compsTotalGraph, lines, { filename: `${stem}_booktypes_radar`, caption: { title: 'Distribution of hits over book types (share of hits)', subtitle: searchCaption(R), note: base, footer: footer() } })
  else {
    const rows = comparedRows(R), order = typesOf(rows), at = new Map(rows.map(r => [r.label + '\u0000' + r.compsFinal, r]))
    const series = lines.map(l => { const rs = order.map(t => at.get(l.label + '\u0000' + t))
      return { name: labelIt(l), index: l.index, values: rs.map(r => (vs ? r.ratio : r.share)), ...(vs ? { faint: rs.map(r => r.ngramCount < FEW_HITS) } : {}),
        hover: rs.map(r => (vs ? `${esc(r.compsFinal)} — ${esc(l.userLabel)}<br>${r.ngramCount.toLocaleString('en')} of ${r.lineHits.toLocaleString('en')} hits (${pct(r.share)}) · ${pct(r.corpusShare)} of corpus tokens<br>${r.ratio === null ? 'n/a' : `${r.ratio.toFixed(2)}×`} as expected` : `${esc(l.userLabel)}: ${pct(r.share)} of hits (${r.ngramCount.toLocaleString('en')})`)) } })
    const ties = ' A book tied between two types counts under both.'
    await typeBars($('#chart-typebars'), { types: order, series, separate: V.tlayout === 'separate', scale: vs ? 'ratio' : 'share', xTitle: vs ? 'share of hits ÷ share of corpus tokens (log scale)' : 'share of hits',
      filename: `${stem}_booktypes_${vs ? 'vs_corpus' : 'share'}_${V.tlayout}`,
      caption: { title: vs ? 'Hits by book type compared with the corpus' : 'Distribution of hits over book types (share of hits)', subtitle: searchCaption(R), footer: footer(),
        note: `${base}${vs ? ` Each bar: the line's share of hits in the type divided by the type's share of the corpus tokens. 1× = as expected from the type's share of the corpus; 2× = twice as frequent; 0.5× = half as frequent. Light bars rest on fewer than ${FEW_HITS} hits. No bar: no hits.${ties}` : ` Types in alphabetical order.${ties}`}` } })
  }
  drawTypesTable()
}
// wide screens: search lines as rows, types (by code) as columns; phones: the long layout
function drawTypesTable() {
  const R = S.results, V = S.view, vs = V.tchart !== 'radar' && V.tmeasure === 'corpus', rows = comparedRows(R), host = $('#tbl-types'), key = $('#types-key')
  S.typesNarrow = narrow()
  const value = r => (vs ? r.ratio ?? 0 : r.share), top = new Map(); for (const r of rows) top.set(r.label, Math.max(top.get(r.label) ?? 0, value(r)))
  const lineOf = new Map(R.lines.map(l => [l.label, l]))
  if (narrow()) { const cell = (v, r) => `<span class="shaded" style="${shade(value(r), top.get(r.label), lineOf.get(r.label))}">${esc(fmt(v))}</span>`
    key.innerHTML = ''; renderTable(host, [...rows].sort((a, b) => byType(a.compsFinal, b.compsFinal)), ['label', 'compsFinal', 'ngramCount', 'percentage', ...(vs ? ['corpusShare', 'ratio'] : [])], { render: vs ? { ratio: cell } : { percentage: cell } }); return }
  const order = typesOf(rows), at = new Map(rows.map(r => [r.label + '\u0000' + r.compsFinal, r]))
  const cell = r => { const v = vs ? (r.ngramCount ? `${r.ratio.toFixed(2)}×` : '–') : pct(r.share)
    return `<td class="num" style="${shade(value(r), top.get(r.label), lineOf.get(r.label))}" title="${esc(r.compsFinal)}: ${r.ngramCount.toLocaleString('en')} hits, ${pct(r.share)}; corpus ${pct(r.corpusShare)}">${v}</td>` }
  host.innerHTML = `<div class="table-scroll"><table class="pivot"><thead><tr><th>Search line</th>${order.map(t => `<th class="num" title="${esc(t)}">${esc(typeCode(t))}</th>`).join('')}</tr></thead>
    <tbody>${typeLines(R).map(l => `<tr><td><i>${esc(l.userLabel)}</i></td>${order.map(t => cell(at.get(l.label + '\u0000' + t))).join('')}</tr>`).join('')}</tbody></table></div>`
  key.innerHTML = `${vs ? 'Share of hits ÷ share of corpus tokens. ' : 'Share of the line’s hits. '}Darker: larger within the line. ${order.map(t => `<b>${esc(typeCode(t))}</b> ${esc(typeName(t))}`).join(' · ')}`
}

async function drawTab(id) {
  if (!S.results || !S.dirty.has(id)) return
  S.dirty.delete(id); const R = S.results, stem = fileStem()
  if (id === 'time') await drawTime()
  else if (id === 'types') await drawTypes()
  else if (id === 'typestime') {
    const box = $('#charts-types'); box.innerHTML = ''
    const gmax = Math.max(...R.compsPeriodsGraph.map(r => r.freqsNorm))
    for (const l of R.lines.filter(l => R.compsPeriodsGraph.some(r => r.label === l.label && r.freqsNorm > 0))) {
      const d = document.createElement('div'); d.className = 'chart tall'; box.appendChild(d)
      await typesOverTimeChart(d, R.compsPeriodsGraph, l, gmax, { aspect: aspect(), filename: `${stem}_booktypes_over_time_${l.index + 1}`,
        caption: { title: `Book types over time: ${labelIt(l)}`, subtitle: [`${labelIt(l)}: ${lineDetail(l)}`], note: `${corpusLine(R)} Height: hits per period and type, relative to the largest value of the search.`, footer: footer() } })
    }
  } else if (id === 'century') { const lineOf = new Map(R.lines.map(l => [l.label, l]))
    renderTable($('#tbl-century'), R.chronoTable, CHRONO_TABLE_COLS, { rtl: ['ngram'], rowStyle: r => { const st = styleOf(lineOf.get(r.search)?.index ?? 0); return `background:rgba(${st.rgb},0.09);box-shadow:inset 4px 0 0 ${st.color}` } }) }
  else if (id === 'books') renderTable($('#tbl-books'), withBookLabels(R.booksTable), BOOK_COLS, { rtl: ['Arabic', 'ngramAll'], render: { Book: renderBookLabel, URL: v => v ? `<a href="${esc(v)}" target="_blank" rel="noopener">text</a>` : '' } })
  else if (id === 'authors') renderTable($('#tbl-authors'), withAuthorLabels(R.authorsTable), AUTHOR_COLS, { rtl: ['Arabic', 'ngramAll'], render: { Author: renderAuthorLabel } })
}
const activeCharts = () => [...document.querySelectorAll(`[data-pane="${T.active}"] .js-plotly-plot:not([hidden])`)]
let resizeTimer
function onResize() { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { activeCharts().forEach(el => redraw(el)); if (S.results && T.active === 'types' && S.typesNarrow !== narrow()) drawTypes() }, 180) }

// ---- downloads -----------------------------------------------------------------------------------------
const TABLES = {
  chronoGraph: R => [R.chronoGraph, ['label', 'ngramAll', ...PERIODS_PLOT.map(String)]],
  chronoGraphRelative: R => [R.relative.map(r => Object.fromEntries([['label', r.label], ...PERIODS_PLOT.map((p, i) => [String(p), r.values[i]])])), ['label', ...PERIODS_PLOT.map(String)]],
  chronoTable: R => [R.chronoTable, CHRONO_TABLE_COLS],
  booksTable: R => [withBookLabels(R.booksTable), [...BOOK_COLS.slice(0, 3), 'labelUncertain', ...BOOK_COLS.slice(3)]],
  authorsTable: R => [withAuthorLabels(R.authorsTable), AUTHOR_COLS],
  compsTotalGraph: R => [comparedRows(R), ['label', 'compsFinal', 'ngramCount', 'lineHits', 'percentage', 'corpusTokens', 'corpusShare', 'ratio']],
  compsPeriodsGraph: R => [R.compsPeriodsGraph, ['label', 'compsFinal', 'order', 'periods', 'freqsNorm']],
  bookData: R => [R.bookData, ['ID', 'label', 'ngramTR', 'ngram', 'count', 'bookURI']],
  corpusSize: R => [PERIODS_PLOT.map(p => ({ period: p, tokens: S.P.modes[R.mode].periodTokens.get(p) ?? 0 })), ['period', 'tokens']],
}
const DESCRIPTIONS = {
  bookData: 'one row per ticked form per book (label = search line; ngramTR = transliteration; ngram = Arabic script; count = occurrences in the book); within each form, books in bookID order.',
  corpusSize: 'tokens of the selected corpus per 25-year period (the grey bars of the Over time chart).',
  chronoGraph: 'per search line, absolute counts per 25-year AH period (columns 100 ... 1400 = period end, AH) and the matched forms (ngramAll).',
  chronoGraphRelative: 'per search line, relative frequencies per period: count / tokens of the selected corpus in that period (unsmoothed).',
  chronoTable: 'per form, counts per century (columns 100 ... 1400 = century end, AH; century 100 includes periods 25-100), with totals per search and per form.',
  booksTable: 'per search line and book: Book = readable title and author (working label, *italics* markup), Arabic = Arabic title, labelUncertain = 1 if the label is uncertain; count, count / book length, book length, book type (compsFinal, compsValue, compsPrelim), matched forms; URL = the text at the OpenITI release.',
  authorsTable: "per search line and author: Author = readable name (working label), Arabic = Arabic name; count, count / tokTotal (all of the author's books in the selected corpus), matched forms.",
  compsTotalGraph: 'per search line, hits by book type (ngramCount; lineHits = all hits of the line) and their share (the bars and the radar); corpusTokens = tokens of the selected corpus in the type (a tied book counts under both of its types, as its hits do), corpusShare = their share of the corpus, ratio = unrounded share of hits / corpusShare (the Compared with corpus view).',
  compsPeriodsGraph: 'per search line, book type and period, counts normalised by the largest period count of the search (book types over time).',
}
async function downloadAll() {
  const R = S.results; if (!R) return
  const files = {}
  for (const [name, f] of Object.entries(TABLES)) { const [rows, cols] = f(R); files[`${name}.tsv`] = toTSV(rows, cols) }
  const now = new Date()
  const readme = [
    `${APP.name} (${APP.version}), app commit ${S.appCommit ?? 'not available'} (https://github.com/${APP.repo})`,
    `Data: OpenITI release ${S.release.release}; data repository ${S.release.repo}, commit ${dataCommit(S.release)}`,
    `Downloaded: ${now.toISOString()} (${now.toString()})`,
    `Corpus: ${R.mode === 'all' ? 'keep all texts (100%)' : 'remove problematic (~95%)'}; smoothing span (charts only): ${R.span}`,
    `Page address of this result: ${location.href}`,
    '', 'Cite as:', CITE.text('chicago').replace(/\*/g, ''),
    '', 'Search lines and ticked forms:',
    ...R.lines.flatMap(l => { const p = S.previews.find(x => x.line.index === l.index); return [`  ${l.index + 1}. ${p.line.line}`, `     regex: ${l.regex}`, `     ticked forms (${l.ids.length} of ${p.ids.length}): ${l.ids.map(id => p.tr[p.ids.indexOf(id)]).join(', ')}`] }),
    '', 'Book titles and author names (columns Book, Author, Arabic) are working labels and may contain errors; the URI is authoritative.',
    `Labels: ${S.release.repo}, commit ${dataCommit(S.release)}, labels/ (generated with a language model; without a label the column repeats the URI).`,
    '', 'Files (UTF-8, tab-separated, header row; character fields and column names in double quotes, embedded quotes doubled; NA = not available):',
    ...Object.keys(TABLES).map(n => `  ${n}.tsv: ${DESCRIPTIONS[n]} Columns: ${TABLES[n](R)[1].join(', ')}.`),
  ].join('\n') + '\n'
  files['README.txt'] = readme
  saveBlob(await zipFiles(files), `${fileStem()}_${stamp()}.zip`)
}

// ---- URL state, citation and version line ------------------------------------------------------------------------
// the whole view in the hash (see share.js); defaults are left out. Old ?l=… links are still read (state.js).
const viewState = () => { const V = S.view, x = {}; S.previews.forEach((p, i) => { if (p.excluded.size) x[i] = [...p.excluded].sort((a, b) => a - b).map(n => n.toString(36)).join('.') })
  return { l: S.previews.map(p => p.line.line), ...(Object.keys(x).length ? { x } : {}), ...(mode() === 'all' ? { m: 'a' } : {}), ...(span() !== 0.2 ? { s: span() } : {}), ...(S.release.release === DEFAULT_RELEASE ? { c: S.release.commit.slice(0, 7) } : { d: `${S.release.release}@${S.release.commit}` }),
    ...(T.active !== 'time' ? { t: T.active } : {}), ...(V.value !== 'rel' ? { r: 0 } : {}), ...(V.layout !== 'together' ? { p: 1 } : {}), ...(V.corpus ? { k: 1 } : {}), ...(V.ratio !== '3' ? { a: 2 } : {}), ...(V.tchart === 'radar' ? { q: 1 } : {}), ...(V.tlayout === 'separate' ? { y: 1 } : {}), ...(V.tmeasure === 'corpus' ? { e: 1 } : {}) } }
async function updateURL() { if (S.previews.length) history.replaceState(null, '', location.pathname + await packState(viewState())) }
function fromPacked(o) {
  const lines = o.l ?? [], excluded = lines.map((_, i) => new Set((o.x?.[i] ?? '').split('.').filter(Boolean).map(t => parseInt(t, 36))))
  return { lines, excluded, mode: o.m === 'a' ? 'all' : 'clean', span: o.s ?? 0.2, release: o.d ?? (o.c ? `${DEFAULT_RELEASE}@${o.c}` : null), tab: o.t, view: { value: o.r === 0 ? 'abs' : 'rel', layout: o.p ? 'separate' : 'together', corpus: o.k === 1, ratio: o.a === 2 ? '2' : '3', tchart: o.q ? 'radar' : 'bars', tlayout: o.y ? 'separate' : 'together', tmeasure: o.e ? 'corpus' : 'share' } }
}
const citation = () => { const R = S.results, y = new Date().getFullYear()
  return { year: y, title: `Results for ${R.lines.map(l => l.userLabel).join(', ')}`, app: CITATION.title, version: CITATION.version, doi: CITATION.doi, data: CITATION.data,
    search: `${R.lines.map(l => { const { p, forms } = formsOf(l); return `${p.line.line} (${forms.length.toLocaleString('en')} of ${p.ids.length.toLocaleString('en')} forms)` }).join('; ')}; ${modeText(R.mode)}`,
    accessed: today(), link: location.href, key: `romanov${y}ngramreader` } }
async function versionLine() {
  try {
    const cached = sessionStorage.getItem('ngr-app-commit')
    S.appCommit = cached || (location.hostname === 'localhost' ? 'local' : (await (await fetch(`https://api.github.com/repos/${APP.repo}/commits/main`)).json()).sha?.slice(0, 7)) || null
    if (S.appCommit) sessionStorage.setItem('ngr-app-commit', S.appCommit)
  } catch { S.appCommit = null }
  const c = dataCommit(S.release)
  $('#version').innerHTML = `${APP.name} ${APP.version} · app commit <a href="https://github.com/${APP.repo}/commit/${S.appCommit ?? ''}">${S.appCommit ?? 'n/a'}</a> · data: OpenITI ${S.release.release}, <a href="https://github.com/${S.release.repo}/tree/${c}">${S.release.repo.split('/')[1]}@${c.slice(0, 7)}</a>`
}

// ---- wiring --------------------------------------------------------------------------------------------
const TAB_LIST = [{ id: 'time', label: 'Over time' }, { id: 'types', label: 'Book types' }, { id: 'typestime', label: 'Types over time' }, { id: 'century', label: 'Centuries' }, { id: 'books', label: 'Books' }, { id: 'authors', label: 'Authors' }, { id: 'map', label: 'Map (soon)', soon: true }]
const T = tabs($('#tabs'), TAB_LIST, async id => { await updateURL(); await drawTab(id); activeCharts().forEach(el => redraw(el)) })
const UI = panel({ onResize })
const CITE = citeDialog(citation)
function switches() {
  const paint = () => { for (const [host, v] of [['#sw-value', S.view.value], ['#sw-layout', S.view.layout], ['#sw-ratio', S.view.ratio], ['#sw-ratio2', S.view.ratio], ['#sw-tchart', S.view.tchart], ['#sw-tlayout', S.view.tlayout], ['#sw-tmeasure', S.view.tmeasure]]) $(host).querySelectorAll('button').forEach(b => { b.classList.toggle('on', b.dataset.v === v); b.setAttribute('aria-pressed', b.dataset.v === v) }); $('#sw-corpus').checked = S.view.corpus; for (const h of ['#sw-tlayout', '#sw-tmeasure']) $(h).classList.toggle('off', S.view.tchart === 'radar') }
  const apply = async () => { paint(); if (S.results) { await updateURL(); S.dirty.add('time'); S.dirty.add('types'); S.dirty.add('typestime'); await drawTab(T.active) } }
  for (const h of ['#sw-ratio', '#sw-ratio2']) $(h).onclick = e => { const b = e.target.closest('button'); if (b) { S.view.ratio = b.dataset.v; apply() } }
  $('#sw-value').onclick = e => { const b = e.target.closest('button'); if (b) { S.view.value = b.dataset.v; apply() } }
  $('#sw-layout').onclick = e => { const b = e.target.closest('button'); if (b) { S.view.layout = b.dataset.v; apply() } }
  for (const [h, k] of [['#sw-tchart', 'tchart'], ['#sw-tlayout', 'tlayout'], ['#sw-tmeasure', 'tmeasure']]) $(h).onclick = e => { const b = e.target.closest('button'); if (b) { S.view[k] = b.dataset.v; apply() } }
  { const how = $('#how-compared')      // the reader's choice to collapse the explanation, kept in this browser
    try { how.open = localStorage.getItem('ngr-how-compared') !== 'closed' } catch {}
    how.ontoggle = () => { try { localStorage.setItem('ngr-how-compared', how.open ? 'open' : 'closed') } catch {} } }
  $('#sw-corpus').onchange = () => { S.view.corpus = $('#sw-corpus').checked; apply() }
  paint()
}
const dl = name => { const [rows, cols] = TABLES[name](S.results); saveText(toTSV(rows, cols), `${fileStem()}_${name}.tsv`) }
async function init() {
  const packed = await unpackState(location.hash)
  const st = packed ? fromPacked(packed) : decodeState(location.search)
  S.release = st.release ? resolveRelease(st.release) : RELEASES[DEFAULT_RELEASE]
  if (st.view) S.view = { ...S.view, ...st.view }
  document.querySelector(`input[name=mode][value=${st.mode}]`).checked = true
  $('#span').value = st.span; $('#span-val').textContent = st.span <= 0.1 ? 'none' : st.span
  ;(st.lines.length ? st.lines : ['#al-kutub al-sittaŧ #(\\w+)?lktb_Alsto']).forEach(l => addLine(l))
  T.enable(Object.fromEntries(TAB_LIST.map(t => [t.id, false])))
  T.active = st.tab ?? 'time'
  dialogs(); switches()
  $('#link-other').href = classifierURL()
  const c = CITATION; $('#citation-block').innerHTML = `<b>Citation:</b> Romanov, Maxim. (${c.year}). <i>${esc(c.title)} (based on OpenITI, Release ver. 2023.1.8)</i> (Version ${c.version}) [Software]. Zenodo. <a href="https://doi.org/${c.doi}">https://doi.org/${c.doi}</a>`
  const help = e => { e.preventDefault(); $('#help-dialog').showModal() }
  $('#open-help').onclick = help; document.querySelectorAll('[data-help]').forEach(a => a.onclick = help)
  $('#cite').onclick = () => CITE.open()
  $('#copy-link').onclick = async () => { await updateURL(); copyText(location.href, 'Link copied') }
  $('#add').onclick = () => { addLine(); document.querySelector('#lines .line:last-child input').focus() }
  $('#search').onclick = () => runSearch()
  $('#update').onclick = async () => { if (S.busy) return; S.busy = true; try { await computeAndRender() } finally { S.busy = false; status('') } }
  document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = async () => {
    S.previews.forEach(p => { const el = [...document.querySelectorAll('#preview details')][S.previews.indexOf(p)]; if (el) drawPreview(el, p) })
    if (S.results && !S.busy) { S.busy = true; try { await computeAndRender() } finally { S.busy = false; status('') } }
  })
  $('#span').oninput = () => { $('#span-val').textContent = span() <= 0.1 ? 'none' : span() }
  $('#span').onchange = async () => { if (S.results) { S.results.span = span(); await updateURL(); S.dirty.add('time'); await drawTab('time') } }
  document.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => { if (S.results) dl(b.dataset.dl) })
  exportBar($('#x-time'), () => [$('#chart-time')], () => { if (S.view.layout === 'separate') { dl('chronoGraph'); dl('chronoGraphRelative') } else dl(S.view.value === 'rel' ? 'chronoGraphRelative' : 'chronoGraph'); dl('corpusSize') })
  exportBar($('#x-types'), () => [$(S.view.tchart === 'radar' ? '#chart-radar' : '#chart-typebars')], () => dl('compsTotalGraph'))
  exportBar($('#x-typestime'), () => [...document.querySelectorAll('#charts-types .js-plotly-plot')], () => dl('compsPeriodsGraph'))
  $('#download-all').onclick = downloadAll
  new ResizeObserver(onResize).observe($('#content'))
  fontControls(() => activeCharts().forEach(el => redraw(el)))
  versionLine()
  if (st.lines.length) runSearch({ excluded: st.excluded.map(s => [...s]) })
  else UI.fold(false)
}
init()
