// Result tables, ported from the R reference app (adhfais_app1_local_2026_parquet, commit 825b4bb, app.R):
// startup derivations (labelsRoll, booksClassified, periodCounts) and getData() (bookData, chronoGraph,
// chronoTable, booksTable, authorsTable, compsTotalGraph, compsPeriodsGraph). Column names and row order follow
// R (dplyr sorts groups in C locale, i.e. by code point). Two R quirks are not reproduced (see README):
// (1) when one form matches in two search lines, R duplicates its per-book rows; here each line counts it once;
// (2) R gives the "zero" book-type rows of compsTotalGraph only to the first search line; here every line gets them.

export const PERIODS_ALL = Array.from({ length: 60 }, (_, i) => 25 * (i + 1))           // 25..1500 (R ngramDummy)
export const PERIODS_PLOT = PERIODS_ALL.filter(p => p >= 100 && p <= 1400)            // 100..1400
export const CENTURIES = Array.from({ length: 14 }, (_, i) => 100 * (i + 1))            // 100..1400
const SEP = ' ٬ '                                                                       // R: collapse = " ٬ "

// R 4.x round(x, digits): the nearer of floor/ceil at that decimal, ties to even (src/nmath/fround.c)
export function roundR(x, d) {
  if (!Number.isFinite(x)) return x
  const p = 10 ** d, x10 = x * p, i10 = Math.floor(x10)
  const xd = i10 / p, xu = Math.ceil(x10) / p
  const du = xu - x, dd = x - xd
  return (du < dd || (du === dd && i10 % 2 === 1)) ? xu : xd
}
// R signif(x, digits) (src/nmath/fprec.c): scale by a power of ten, nearbyint (ties to even), scale back
const rint = v => { const r = Math.round(v); return Math.abs(v % 1) === 0.5 ? 2 * Math.round(v / 2) : r }
export function signifR(x, digits) {
  if (!Number.isFinite(x) || x === 0) return x
  const sgn = x < 0 ? -1 : 1; x = Math.abs(x)
  const e10 = digits - 1 - Math.floor(Math.log10(x))
  if (e10 > 0) { const p = 10 ** e10; return sgn * (rint(x * p) / p) }
  const p = 10 ** -e10; return sgn * (rint(x / p) * p)
}
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)              // code-point order (C locale), for strings and numbers
export const periodOfURI = uri => Math.ceil(parseInt(uri.slice(0, 4), 10) / 25) * 25   // plyr::round_any(year, 25, ceiling)
export const authorOfURI = uri => uri.split('.')[0]

// ---- startup derivations ---------------------------------------------------------------------------
export function prepare(st) {
  // labelsRoll (app.R:73-85): "[ABBR] english" from comps_labels + types_final (MODEL == types10), plus
  // "[U] undefined"; sorted descending; order = (row - 1) * 1.15
  const abbr = new Map(st.typesFinal.filter(t => t.MODEL === 'types10').map(t => [t.TYPES, t.ABBR]))
  const roll = st.compsLabels.map(l => ({ class: l.class, classLabel: `[${(abbr.get(l.class) ?? 'NA').toUpperCase()}] ${l.english}` }))
  roll.push({ class: 'undefined', classLabel: '[U] undefined' })
  roll.sort((a, b) => cmp(b.classLabel, a.classLabel))
  roll.forEach((r, i) => { r.order = i * 1.15 })
  const classLabel = new Map(roll.map(r => [r.class, r.classLabel]))
  const orderOf = new Map(roll.map(r => [r.classLabel, r.order]))
  // booksClassified (app.R:100-110): top-scoring type(s) per book (ties kept), index < 0.099 -> 0,
  // index == 0.1 -> "[U] undefined", index == 0 -> "----", distinct
  const typeCols = Object.keys(st.mainData[0]).filter(k => k !== 'bookURI')
  const booksClassified = new Map()
  for (const b of st.mainData) {
    const max = Math.max(...typeCols.map(c => b[c]))
    const rows = []
    for (const c of typeCols) {
      if (b[c] !== max) continue
      let index = b[c] < 0.099 ? 0 : b[c]
      let comparables = classLabel.get(c)
      if (index === 0.1) comparables = '[U] undefined'
      if (index === 0) comparables = '----'
      if (!rows.some(r => r.comparables === comparables && r.index === index)) rows.push({ comparables, index, authorURI: authorOfURI(b.bookURI) })
    }
    booksClassified.set(b.bookURI, rows)
  }
  const uriOf = new Map(st.frozen.map(f => [f.bookID, f.bookURI]))
  // book links: the book's primary version at the OpenITI release tag (derived/book_links.tsv); otherwise the
  // R app's link (OpenITI GitHub master) when it has one
  const urlOf = new Map()
  for (const u of st.urls) { const href = /href="(https?:[^"]+)"/.exec(u.URL ?? ''); if (href && !urlOf.has(u.bookID)) urlOf.set(u.bookID, href[1]) }   // some R links point to "NA": no link
  const releasePath = new Map(st.bookLinks.filter(l => l.path).map(l => [l.bookURI, l.path]))
  const linkOf = (bookID, bookURI) => releasePath.has(bookURI) ? `https://raw.githubusercontent.com/OpenITI/RELEASE/v${st.release}/${releasePath.get(bookURI)}` : (urlOf.get(bookID) ?? null)
  const modes = {}
  for (const mode of ['all', 'clean']) {
    const books = st.books.filter(b => mode === 'all' || b.CLEAN === 'CLEAN')
    const byURI = new Map(books.map(b => [b.bookURI, b]))
    const periodTokens = new Map(); const authorTokens = new Map()
    for (const b of books) {
      const p = periodOfURI(b.bookURI); periodTokens.set(p, (periodTokens.get(p) ?? 0) + b.tok_length)
      const a = authorOfURI(b.bookURI); authorTokens.set(a, (authorTokens.get(a) ?? 0) + b.tok_length)
    }
    modes[mode] = { bookIDs: new Set(books.map(b => b.bookID)), byURI, periodTokens, authorTokens, nBooks: books.length,
                    tokens: books.reduce((s, b) => s + b.tok_length, 0) }
  }
  return { roll, orderOf, booksClassified, uriOf, linkOf, modes }
}

// ---- getData() ------------------------------------------------------------------------------------
// lines: [{ label, ids (ticked, ascending) }]; rowsById: Map(ID -> [{ bookID, count }] in bookID order);
// arabic, tr: Map(ID -> string)
export function compute(lines, rowsById, arabic, tr, P, mode) {
  const M = P.modes[mode]
  // bookData (app.R getData): one row per line x ID x book of the active corpus
  const bookData = []
  for (const L of lines) for (const id of L.ids) for (const r of rowsById.get(id) ?? []) {
    if (!M.bookIDs.has(r.bookID)) continue
    bookData.push({ ID: id, label: L.label, ngramTR: tr.get(id), ngram: arabic.get(id), count: r.count, bookURI: P.uriOf.get(r.bookID) })
  }
  if (bookData.length === 0) return null
  // chronoData: per line x ID, counts per 25-year period (25..1500)
  const chrono = new Map()   // key label\u0000ID -> { label, ID, ngram, byPeriod: Map }
  for (const r of bookData) {
    const k = r.label + '\u0000' + r.ID
    let c = chrono.get(k); if (!c) chrono.set(k, (c = { label: r.label, ID: r.ID, ngram: r.ngram, byPeriod: new Map() }))
    const p = periodOfURI(r.bookURI); c.byPeriod.set(p, (c.byPeriod.get(p) ?? 0) + r.count)
  }
  const chronoRows = [...chrono.values()]        // insertion order = line order, then ID order (R filtDT order)
  const labels = [...new Set(chronoRows.map(c => c.label))].sort(cmp)
  // chronoGraph: per line, sums per period 100..1400 and the matched forms
  const chronoGraph = labels.map(label => {
    const rows = chronoRows.filter(c => c.label === label)
    const o = { label, ngramAll: [...new Set(rows.map(r => r.ngram))].join(SEP) }
    for (const p of PERIODS_PLOT) o[p] = rows.reduce((s, r) => s + (r.byPeriod.get(p) ?? 0), 0)
    return o
  })
  const maxValueInPeriods = Math.max(...chronoGraph.flatMap(g => PERIODS_PLOT.map(p => g[p])))
  // chronoTable: per line and form, counts per century; century = ceiling(period / 100) * 100, kept 100..1400
  const chronoTable = []
  for (const label of labels) {
    const rows = chronoRows.filter(c => c.label === label)
    const cent = r => { const o = new Map(); for (const [p, v] of r.byPeriod) { const c = Math.ceil(p / 100) * 100; if (c >= 100 && c <= 1400) o.set(c, (o.get(c) ?? 0) + v) } return o }
    const perSearch = rows.reduce((s, r) => s + [...cent(r).values()].reduce((a, b) => a + b, 0), 0)
    const byNgram = new Map()
    for (const r of rows) {
      let g = byNgram.get(r.ngram); if (!g) byNgram.set(r.ngram, (g = new Map()))
      for (const [c, v] of cent(r)) g.set(c, (g.get(c) ?? 0) + v)
    }
    const groups = [...byNgram.entries()].map(([ngram, g]) => {
      const perNgram = [...g.values()].reduce((a, b) => a + b, 0)
      const o = { search: label, perSearch, ngram, perNgram, perNgramRel: roundR(perNgram / perSearch, 5) }
      for (const c of CENTURIES) o[c] = g.get(c) ?? 0
      return o
    })
    groups.sort((a, b) => cmp(a.ngram, b.ngram) || cmp(a.perNgram, b.perNgram) || cmp(a.perNgramRel, b.perNgramRel))
    chronoTable.push(...groups)
  }
  // booksTable (bookDataSummary): per line and book; booksClassified may give two rows for a tied book (as in R)
  const bookGroups = new Map()
  for (const r of bookData) {
    const k = r.label + '\u0000' + r.bookURI
    let g = bookGroups.get(k); if (!g) bookGroups.set(k, (g = { label: r.label, bookURI: r.bookURI, countTotal: 0, ngrams: [] }))
    g.countTotal += r.count; g.ngrams.push(r.ngram)
  }
  const booksTable = []
  for (const g of [...bookGroups.values()].sort((a, b) => cmp(a.label, b.label) || cmp(a.bookURI, b.bookURI))) {
    const book = M.byURI.get(g.bookURI)
    for (const bc of P.booksClassified.get(g.bookURI) ?? [{ comparables: null, index: null }]) {
      booksTable.push({ label: g.label, bookURI: g.bookURI, URL: P.linkOf(book?.bookID, g.bookURI), countTotal: g.countTotal,
        countRel: signifR(g.countTotal / book.tok_length, 3), tok_length: book.tok_length,
        compsFinal: bc.index < 0.5 ? '[U] undefined' : bc.comparables, compsValue: bc.index, compsPrelim: bc.comparables,
        ngramAll: g.ngrams.join(SEP) })
    }
  }
  stableSortDesc(booksTable, 'countTotal')
  // authorsTable: per line and author; denominator = all of the author's books in the active corpus, once
  const authGroups = new Map()
  for (const r of bookData) for (const bc of P.booksClassified.get(r.bookURI) ?? []) {
    const k = r.label + '\u0000' + bc.authorURI
    let g = authGroups.get(k); if (!g) authGroups.set(k, (g = { label: r.label, authorURI: bc.authorURI, countTotal: 0, ngrams: [] }))
    g.countTotal += r.count; if (!g.ngrams.includes(r.ngram)) g.ngrams.push(r.ngram)
  }
  const authorsTable = [...authGroups.values()].sort((a, b) => cmp(a.label, b.label) || cmp(a.authorURI, b.authorURI)).map(g => {
    const tokTotal = M.authorTokens.get(g.authorURI)
    return { label: g.label, authorURI: g.authorURI, countTotal: g.countTotal, countRel: signifR(g.countTotal / tokTotal, 3), tokTotal, ngramAll: g.ngrams.join(SEP) }
  })
  stableSortDesc(authorsTable, 'countTotal')
  // compsTotalGraph: per line, hits by book type (from booksTable rows), share signif(4); all types present
  const bookLabels = [...new Set(booksTable.map(r => r.label))].sort(cmp)
  const compsTotalGraph = []
  for (const label of bookLabels) {
    const sums = new Map(P.roll.map(r => [r.classLabel, 0]))
    for (const r of booksTable) if (r.label === label) sums.set(r.compsFinal, (sums.get(r.compsFinal) ?? 0) + r.countTotal)
    const total = [...sums.values()].reduce((a, b) => a + b, 0)
    const present = new Set(booksTable.filter(r => r.label === label).map(r => r.compsFinal))
    for (const [compsFinal, ngramCount] of [...sums.entries()].sort((a, b) => cmp(a[0], b[0])))
      compsTotalGraph.push({ label, compsFinal, ngramCount, percentage: present.has(compsFinal) ? signifR(ngramCount / total, 4) : 0 })
  }
  // compsPeriodsGraph: per line, book type and period 100..1400, counts / maxValueInPeriods; order from labelsRoll
  const compsPeriodsGraph = []
  for (const label of bookLabels) {
    const sums = new Map()
    for (const r of booksTable) if (r.label === label) { const k = r.compsFinal + '\u0000' + periodOfURI(r.bookURI); sums.set(k, (sums.get(k) ?? 0) + r.countTotal) }
    const types = [...new Set([...P.roll.map(r => r.classLabel)])].sort(cmp)
    for (const compsFinal of types) for (const periods of PERIODS_PLOT)
      compsPeriodsGraph.push({ label, compsFinal, order: P.orderOf.get(compsFinal), periods, freqsNorm: (sums.get(compsFinal + '\u0000' + periods) ?? 0) / maxValueInPeriods })
  }
  return { bookData, chronoGraph, chronoTable, booksTable, authorsTable, compsTotalGraph, compsPeriodsGraph, maxValueInPeriods }
}

function stableSortDesc(arr, key) {
  const idx = arr.map((r, i) => [r, i]); idx.sort((a, b) => (b[0][key] - a[0][key]) || (a[1] - b[1]))
  idx.forEach(([r], i) => { arr[i] = r })
}

// relative frequency series of chronoGraph for a mode: count / tokens of the active corpus in that period
export function relative(chronoGraph, P, mode) {
  const T = P.modes[mode].periodTokens
  return chronoGraph.map(g => ({ label: g.label, values: PERIODS_PLOT.map(p => T.has(p) ? g[p] / T.get(p) : NaN) }))
}
