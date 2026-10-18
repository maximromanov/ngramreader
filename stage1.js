// OpenITI NgramReader static v1 — stage 1: one search end to end from GitHub raw files (no design).
// Reference semantics: the R Parquet app (adhfais_app1_local_2026_parquet, commit 825b4bb):
//   query parsing   app.R labelVar/regexVar/unifiedRegex (items OR-ed into \b(...)\b, spaces removed)
//   per-book rows   getData(): rows of the matched IDs, books of the active corpus only
//   periods         period = ceiling(AH year / 25) * 25 from the first 4 digits of bookURI; chronoGraph keeps 100..1400
import { asyncBufferFromUrl, parquetMetadataAsync, parquetReadObjects } from 'https://cdn.jsdelivr.net/npm/hyparquet@1.31.2/+esm'
import { compressors } from 'https://cdn.jsdelivr.net/npm/hyparquet-compressors@1.1.2/+esm'

const RAW = part => `https://raw.githubusercontent.com/maximromanov/ngramreader-data-${part}/main/`
const $ = id => document.getElementById(id)
const t0 = performance.now()
const marks = {}
const mark = (k, t) => { marks[k] = Math.round((t ?? performance.now()) - t0) }

// ---- query parsing, as in the R app ------------------------------------------------------------
function parseLine(line) {
  const noSpaces = line.replace(/^#| +/g, '')               // R: str_replace_all(searchVar, "^#| +", "")
  const parts = noSpaces.split('#')
  const items = parts.length > 1 ? parts.slice(1) : parts    // 2026 fix: single token searches itself
  const labelParts = line.replace(/^#/, '').split('#')
  const label = labelParts[0].replace(/ +$/, '')
  return { label: `${label} (RE: ${items.join('|')})`, items, regex: `\\b(${items.join('|')})\\b` }
}
const orderOf = items => {
  const orders = new Set(items.map(it => (it.match(/_/g) || []).length + 1))
  if (orders.size !== 1) throw new Error('Items of different ngram orders in one search')
  return [...orders][0]
}

// ---- Parquet helpers ----------------------------------------------------------------------------
async function openFile(url, byteLength) {
  const file = await asyncBufferFromUrl({ url, byteLength })
  const metadata = await parquetMetadataAsync(file)
  return { file, metadata }
}
async function readManifest(base) {
  const { file, metadata } = await openFile(base + 'manifest.parquet')
  return parquetReadObjects({ file, metadata, compressors })
}
async function readTable(url, byteLength, columns) {
  const { file, metadata } = await openFile(url, byteLength)
  return parquetReadObjects({ file, metadata, columns, compressors })
}
// rows of the requested IDs: only the row groups whose ID min/max can contain one of them are read
async function readRowsForIds(base, ids) {
  const manifest = await readManifest(base)
  const idSet = new Set(ids)
  const sorted = [...idSet].sort((a, b) => a - b)
  const inRange = (lo, hi) => { let i = 0, j = sorted.length; while (i < j) { const m = (i + j) >> 1; if (sorted[m] < lo) i = m + 1; else j = m } return i < sorted.length && sorted[i] <= hi }
  const out = []; let rowGroupsRead = 0, rowGroupsTotal = 0
  for (const m of manifest) {
    if (!inRange(Number(m.id_min), Number(m.id_max))) continue
    const { file, metadata } = await openFile(base + m.file, Number(m.bytes))
    let rowStart = 0
    for (const rg of metadata.row_groups) {
      const n = Number(rg.num_rows); rowGroupsTotal++
      const st = rg.columns[0].meta_data.statistics   // column 0 = ID
      if (inRange(Number(st.min_value), Number(st.max_value))) {
        rowGroupsRead++
        const rows = await parquetReadObjects({ file, metadata, rowStart, rowEnd: rowStart + n, compressors })
        for (const r of rows) if (idSet.has(r.ID)) out.push(r)
      }
      rowStart += n
    }
  }
  return { rows: out, rowGroupsRead, rowGroupsTotal }
}

// ---- the search ---------------------------------------------------------------------------------
async function run() {
  const params = new URLSearchParams(location.search)
  const line = params.get('q') || '#Baġdād #[wb]?bgdAd'
  const mode = params.get('mode') === 'all' ? 'all' : 'clean'
  const q = parseLine(line)
  const n = orderOf(q.items)
  const part = `${n}gram`
  $('status').textContent = 'Data is being downloaded. This needs to be done only once.'

  // vocabulary (ID table) of this order
  const vocBase = RAW(part) + `data/data_${n}grams2up_HI/`
  const vocManifest = await readManifest(vocBase)
  mark('vocab_manifest')
  let vocab = []
  for (const m of vocManifest) vocab = vocab.concat(await readTable(vocBase + m.file, Number(m.bytes), ['ID', 'ngramTR']))
  mark('vocab_loaded')

  // regex scan
  const re = new RegExp(q.regex)
  const ts = performance.now()
  const matched = vocab.filter(r => re.test(r.ngramTR))
  marks.regex_ms = Math.round(performance.now() - ts)
  mark('regex_done')

  // Arabic strings of the matched IDs
  const ids = matched.map(r => r.ID)
  const ar = await readRowsForIds(RAW(part) + `data/data_${n}grams2up_HI_AR/`, ids)
  const arabic = new Map(ar.rows.map(r => [r.ID, r.ngram]))
  mark('arabic_done')

  // per-book rows of the matched IDs
  const books = await readRowsForIds(RAW(part) + `data_additional/ngrams_per_book/books_${n}gram/`, ids)
  mark('books_done')

  // book metadata (bookID -> bookURI, CLEAN)
  const meta = await readTable(RAW('meta') + 'data_BC/metadata_books.parquet', undefined, ['bookID', 'bookURI', 'CLEAN'])
  mark('meta_done')
  const bookOK = new Map(meta.filter(b => mode === 'all' || b.CLEAN === 'CLEAN').map(b => [b.bookID, b.bookURI]))
  const tr = new Map(matched.map(r => [r.ID, r.ngramTR]))
  const perBook = books.rows.filter(r => bookOK.has(r.bookID))
    .map(r => ({ ID: r.ID, ngramTR: tr.get(r.ID), ngram: arabic.get(r.ID), count: r.count, bookURI: bookOK.get(r.bookID) }))
  const perPeriod = {}
  for (const r of perBook) {
    const period = Math.ceil(parseInt(r.bookURI.slice(0, 4), 10) / 25) * 25
    if (period >= 100 && period <= 1400) perPeriod[period] = (perPeriod[period] || 0) + r.count
  }
  mark('done')

  // transfer accounting from the Resource Timing API
  const res = performance.getEntriesByType('resource').filter(e => e.name.includes('raw.githubusercontent.com') || e.name.includes('jsdelivr'))
  const transfer = {}
  for (const e of res) {
    const k = e.name.includes('jsdelivr') ? 'cdn' : e.name.replace(/^https:\/\/raw\.githubusercontent\.com\/maximromanov\//, '').replace(/\/part-\d+\.parquet$/, '/part-*').replace(/\/[^/]*\.parquet$/, m => m)
    transfer[k] ??= { requests: 0, transferSize: 0, encodedBodySize: 0 }
    transfer[k].requests++; transfer[k].transferSize += e.transferSize; transfer[k].encodedBodySize += e.encodedBodySize
  }
  const result = { line, label: q.label, regex: q.regex, order: n, mode, vocabularySize: vocab.length,
    matchedIDs: matched.map(r => ({ ID: r.ID, ngramTR: r.ngramTR, ngram: arabic.get(r.ID) })),
    perBookRows: perBook.length, perBook, perPeriod,
    rowGroups: { arabic: [ar.rowGroupsRead, ar.rowGroupsTotal], books: [books.rowGroupsRead, books.rowGroupsTotal] } }
  const timing = { marks_ms_from_script_start: marks, navigation_ms: Math.round(performance.getEntriesByType('navigation')[0]?.duration ?? 0), transfer }
  window.__result = result; window.__timing = timing
  $('timings').textContent = JSON.stringify(timing, null, 1)
  $('out').textContent = JSON.stringify(result)
  $('status').textContent = `Done: ${matched.length} forms, ${perBook.length} book rows (${mode}).`
}
run().catch(e => { $('status').textContent = 'Error: ' + e.message; window.__error = String(e && e.stack || e) })
