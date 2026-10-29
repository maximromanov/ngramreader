// OpenITI NgramReader, static v1 — page controller.
import { APP, RELEASES, DEFAULT_RELEASE, dataBase, resolveRelease } from './config.js'
import { validateLines } from './query.js'
import { readByIds, loadStatic, loadLabels } from './data.js'
import { prepare, compute, relative, PERIODS_PLOT, CENTURIES } from './compute.js'
import { chronoChart, combinedChart, radarChart, typesOverTimeChart } from './charts.js'
import { renderTable, esc } from './tables.js'
import { encodeState, decodeState } from './state.js'
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
const renderBookLabel = (v, r) => esc(v).replace(/\*([^*]+)\*/g, '<i>$1</i>') + (r.labelUncertain ? `<sup class="uncertain" title="${UNCERTAIN}">?</sup>` : '')

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
  updateURL()
  if (!R) { message('The ticked forms occur only in texts outside the selected corpus. Choose "keep all texts (100%)" to include them.'); hideResults(); return }
  await renderResults()
  $('#update').hidden = true
}

// ---- match preview ---------------------------------------------------------------------------------------
function renderPreviews(previews) {
  const box = $('#preview'); box.innerHTML = ''
  box.hidden = !previews.length
  previews.forEach((p, k) => {
    const el = document.createElement('details'); el.className = 'pv'; el.open = previews.length === 1 && p.ids.length <= 200
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
    <table class="pv-list"><thead><tr><th></th><th>form</th><th>Arabic</th><th class="num">count (${m === 'all' ? 'all texts' : 'clean texts'})</th></tr></thead><tbody>
    ${rows.slice(p.page * PAGE, (p.page + 1) * PAGE).map(k => `<tr><td><input type="checkbox" data-id="${p.ids[k]}" ${p.excluded.has(p.ids[k]) ? '' : 'checked'} aria-label="tick ${esc(p.tr[k])}"></td>
      <td><code>${esc(p.tr[k])}</code></td><td dir="rtl" lang="ar">${esc(p.ar.get(p.ids[k]) ?? '')}</td><td class="num">${cnt(k).toLocaleString('en')}</td></tr>`).join('')}
    </tbody></table>
    <div class="pager"><button data-p="prev" ${p.page === 0 ? 'disabled' : ''}>‹</button> <span>${rows.length ? p.page * PAGE + 1 : 0}–${Math.min((p.page + 1) * PAGE, rows.length)} of ${rows.length.toLocaleString('en')}${f ? ' (filtered)' : ''}</span> <button data-p="next" ${p.page >= pages - 1 ? 'disabled' : ''}>›</button></div>`
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
function hideResults() { $('#results').hidden = true; S.results = null }
const captionFor = R => R.lines.map(l => {
  const p = S.previews.find(x => x.line.index === l.index)
  const forms = l.ids.map(id => { const k = p.ids.indexOf(id); return `${p.tr[k]} (${p.ar.get(id) ?? ''})` })
  return `<b>${esc(l.userLabel)}</b>: <code>${esc(l.regex)}</code> — ${forms.length.toLocaleString('en')} form${forms.length === 1 ? '' : 's'}: ${esc(forms.join(', '))}`
}).join('<br>')
function setCaption(id, html) {
  const c = $(id); c.innerHTML = html; c.classList.add('collapsed')
  c.onclick = () => c.classList.toggle('collapsed'); c.title = 'click to expand or collapse'
}
function fileStem() { return `NgramReader_${S.results.lines.map(l => l.userLabel.replace(/[^\p{L}\p{N}]+/gu, '')).join('-').slice(0, 40) || 'search'}_${S.results.mode}` }

async function renderResults() {
  const R = S.results; $('#results').hidden = false
  try { S.labels = await loadLabels(dataBase(S.release)) } catch (e) { S.labels = null; console.warn('labels not loaded:', e) }
  const cap = captionFor(R)
  const series = R.chronoGraph.map(g => ({ label: g.label, userLabel: R.lines.find(l => l.label === g.label).userLabel, values: PERIODS_PLOT.map(p => g[p]) }))
  const rel = R.relative.map(r => ({ ...r, userLabel: R.lines.find(l => l.label === r.label).userLabel }))
  const stem = fileStem()
  $('#corpus-note').textContent = `${R.mode === 'all' ? 'All texts' : 'Texts without problematic ones (~95%)'}: ${S.P.modes[R.mode].nBooks.toLocaleString('en')} texts, ${S.P.modes[R.mode].tokens.toLocaleString('en')} tokens. Periods of 25 years AH (by the author's death date), shown 100–1400 AH.`
  await chronoChart($('#chart-abs'), series, { relative: false, span: R.span, filename: stem + '_absolute', title: 'Absolute frequencies' }); setCaption('#cap-abs', cap)
  await chronoChart($('#chart-rel'), rel, { relative: true, span: R.span, filename: stem + '_relative', title: 'Relative frequencies' }); setCaption('#cap-rel', cap)
  const single = series.length === 1
  $('#sec-combined').hidden = !single
  if (single) { await combinedChart($('#chart-comb'), series[0], rel[0], { span: R.span, filename: stem + '_combined' }); setCaption('#cap-comb', cap) }
  const hasTypes = R.compsTotalGraph.some(r => r.ngramCount > 0)
  $('#sec-radar').hidden = !hasTypes; $('#sec-types').hidden = !hasTypes
  if (hasTypes) {
    await radarChart($('#chart-radar'), R.compsTotalGraph, R.lines.filter(l => R.compsTotalGraph.some(r => r.label === l.label)), { filename: stem + '_booktypes_radar' }); setCaption('#cap-radar', cap)
    const box = $('#charts-types'); box.innerHTML = ''
    const gmax = Math.max(...R.compsPeriodsGraph.map(r => r.freqsNorm))
    for (const l of R.lines.filter(l => R.compsPeriodsGraph.some(r => r.label === l.label && r.freqsNorm > 0))) {
      const d = document.createElement('div'); d.className = 'chart tall'; box.appendChild(d)
      await typesOverTimeChart(d, R.compsPeriodsGraph, l, gmax, { filename: `${stem}_booktypes_over_time_${l.index + 1}` })
    }
    setCaption('#cap-types', cap)
  }
  renderTable($('#tbl-century'), R.chronoTable, CHRONO_TABLE_COLS, { rtl: ['ngram'] })
  renderTable($('#tbl-books'), withBookLabels(R.booksTable), BOOK_COLS,
    { rtl: ['Arabic', 'ngramAll'], render: { Book: renderBookLabel, URL: v => v ? `<a href="${esc(v)}" target="_blank" rel="noopener">text</a>` : '' } })
  renderTable($('#tbl-authors'), withAuthorLabels(R.authorsTable), AUTHOR_COLS, { rtl: ['Arabic', 'ngramAll'] })
  renderTable($('#tbl-types'), R.compsTotalGraph, ['label', 'compsFinal', 'ngramCount', 'percentage'])
  $('#sec-century').hidden = !R.chronoTable.length; $('#sec-books').hidden = !R.booksTable.length; $('#sec-authors').hidden = !R.authorsTable.length
}

// ---- downloads -----------------------------------------------------------------------------------------
const TABLES = {
  chronoGraph: R => [R.chronoGraph, ['label', 'ngramAll', ...PERIODS_PLOT.map(String)]],
  chronoGraphRelative: R => [R.relative.map(r => Object.fromEntries([['label', r.label], ...PERIODS_PLOT.map((p, i) => [String(p), r.values[i]])])), ['label', ...PERIODS_PLOT.map(String)]],
  chronoTable: R => [R.chronoTable, CHRONO_TABLE_COLS],
  booksTable: R => [withBookLabels(R.booksTable), [...BOOK_COLS.slice(0, 3), 'labelUncertain', ...BOOK_COLS.slice(3)]],
  authorsTable: R => [withAuthorLabels(R.authorsTable), AUTHOR_COLS],
  compsTotalGraph: R => [R.compsTotalGraph, ['label', 'compsFinal', 'ngramCount', 'percentage']],
  compsPeriodsGraph: R => [R.compsPeriodsGraph, ['label', 'compsFinal', 'order', 'periods', 'freqsNorm']],
  bookData: R => [R.bookData, ['ID', 'label', 'ngramTR', 'ngram', 'count', 'bookURI']],
}
const DESCRIPTIONS = {
  bookData: 'one row per ticked form per book (label = search line; ngramTR = transliteration; ngram = Arabic script; count = occurrences in the book); within each form, books in bookID order.',
  chronoGraph: 'per search line, absolute counts per 25-year AH period (columns 100 ... 1400 = period end, AH) and the matched forms (ngramAll).',
  chronoGraphRelative: 'per search line, relative frequencies per period: count / tokens of the selected corpus in that period (unsmoothed).',
  chronoTable: 'per form, counts per century (columns 100 ... 1400 = century end, AH; century 100 includes periods 25-100), with totals per search and per form.',
  booksTable: 'per search line and book: Book = readable title and author (working label, *italics* markup), Arabic = Arabic title, labelUncertain = 1 if the label is uncertain; count, count / book length, book length, book type (compsFinal, compsValue, compsPrelim), matched forms; URL = the text at the OpenITI release.',
  authorsTable: "per search line and author: Author = readable name (working label), Arabic = Arabic name; count, count / tokTotal (all of the author's books in the selected corpus), matched forms.",
  compsTotalGraph: 'per search line, hits by book type and their share (the radar graph).',
  compsPeriodsGraph: 'per search line, book type and period, counts normalised by the largest period count of the search (book types over time).',
}
async function downloadAll() {
  const R = S.results; if (!R) return
  const files = {}
  for (const [name, f] of Object.entries(TABLES)) { const [rows, cols] = f(R); files[`${name}.tsv`] = toTSV(rows, cols) }
  const now = new Date()
  const readme = [
    `${APP.name} (${APP.version}), app commit ${S.appCommit ?? 'not available'} (https://github.com/${APP.repo})`,
    `Data: OpenITI release ${S.release.release}; data repository ${S.release.repo}, commit ${S.release.commit}`,
    `Downloaded: ${now.toISOString()} (${now.toString()})`,
    `Corpus: ${R.mode === 'all' ? 'keep all texts (100%)' : 'remove problematic (~95%)'}; smoothing span (charts only): ${R.span}`,
    `Page address of this result: ${location.href}`,
    '', 'Search lines and ticked forms:',
    ...R.lines.flatMap(l => { const p = S.previews.find(x => x.line.index === l.index); return [`  ${l.index + 1}. ${p.line.line}`, `     regex: ${l.regex}`, `     ticked forms (${l.ids.length} of ${p.ids.length}): ${l.ids.map(id => p.tr[p.ids.indexOf(id)]).join(', ')}`] }),
    '', 'Book titles and author names (columns Book, Author, Arabic) are working labels and may contain errors; the URI is authoritative.',
    `Labels: ${S.release.repo}, commit ${S.release.commit}, labels/ (generated with a language model; without a label the column repeats the URI).`,
    '', 'Files (UTF-8, tab-separated, header row; character fields and column names in double quotes, embedded quotes doubled; NA = not available):',
    ...Object.keys(TABLES).map(n => `  ${n}.tsv: ${DESCRIPTIONS[n]} Columns: ${TABLES[n](R)[1].join(', ')}.`),
  ].join('\n') + '\n'
  files['README.txt'] = readme
  saveBlob(await zipFiles(files), `${fileStem()}_${stamp()}.zip`)
}

// ---- URL state and version line ------------------------------------------------------------------------------
function updateURL() {
  const lines = S.previews.map(p => p.line.line)
  const excluded = S.previews.map(p => p.excluded)
  history.replaceState(null, '', '?' + encodeState({ lines, excluded, mode: mode(), span: span(), release: S.release }))
}
async function versionLine() {
  try {
    const cached = sessionStorage.getItem('ngr-app-commit')
    S.appCommit = cached || (await (await fetch(`https://api.github.com/repos/${APP.repo}/commits/main`)).json()).sha?.slice(0, 7) || null
    if (S.appCommit) sessionStorage.setItem('ngr-app-commit', S.appCommit)
  } catch { S.appCommit = null }
  $('#version').innerHTML = `${APP.name} ${APP.version} · app commit <a href="https://github.com/${APP.repo}/commit/${S.appCommit ?? ''}">${S.appCommit ?? 'n/a'}</a> · data: OpenITI ${S.release.release}, <a href="https://github.com/${S.release.repo}/tree/${S.release.commit}">${S.release.repo.split('/')[1]}@${S.release.commit.slice(0, 7)}</a>`
}

// ---- wiring --------------------------------------------------------------------------------------------
function init() {
  const st = decodeState(location.search)
  S.release = st.release ? resolveRelease(st.release) : RELEASES[DEFAULT_RELEASE]
  document.querySelector(`input[name=mode][value=${st.mode}]`).checked = true
  $('#span').value = st.span; $('#span-val').textContent = st.span <= 0.1 ? 'none' : st.span
  ;(st.lines.length ? st.lines : ['#al-kutub al-sittaŧ #(\\w+)?lktb_Alsto']).forEach(l => addLine(l))
  $('#add').onclick = () => { addLine(); document.querySelector('#lines .line:last-child input').focus() }
  $('#search').onclick = () => runSearch()
  $('#update').onclick = async () => { if (S.busy) return; S.busy = true; try { await computeAndRender() } finally { S.busy = false; status('') } }
  document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = async () => {
    S.previews.forEach(p => { const el = [...document.querySelectorAll('#preview details')][S.previews.indexOf(p)]; if (el) drawPreview(el, p) })
    if (S.results && !S.busy) { S.busy = true; try { await computeAndRender() } finally { S.busy = false; status('') } }
  })
  $('#span').oninput = () => { $('#span-val').textContent = span() <= 0.1 ? 'none' : span() }
  $('#span').onchange = async () => { if (S.results) { S.results.span = span(); updateURL(); await renderResults() } }
  document.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => { if (!S.results) return; const [rows, cols] = TABLES[b.dataset.dl](S.results); saveText(toTSV(rows, cols), `${fileStem()}_${b.dataset.dl}.tsv`) })
  $('#download-all').onclick = downloadAll
  versionLine()
  if (st.lines.length) runSearch({ excluded: st.excluded.map(s => [...s]) })
}
init()
