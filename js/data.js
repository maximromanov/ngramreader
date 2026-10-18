// Parquet access over the raw route.
// - small tables (metadata): whole-file GET (browser-cacheable);
// - per-book rows and Arabic strings: only the parts whose manifest ID range covers a requested ID, and inside
//   them only the row groups whose ID min/max statistics can contain one (HTTP range requests; a single
//   "Range" header is CORS-safelisted, so no preflight; no other custom headers are ever sent).
import { LIBS } from './config.js'

// fetch with retries: transient network errors and 5xx responses are retried up to 3 times (0.5 s, 1.5 s back-off)
export async function fetchRetry(url, init) {
  let last
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, init)
      if (res.status < 500) return res
      last = new Error(`HTTP ${res.status} for ${url}`)
    } catch (e) { last = e }
    await new Promise(r => setTimeout(r, attempt === 0 ? 500 : 1500))
  }
  throw last
}

let libsPromise
export const libs = () => (libsPromise ??= Promise.all([import(LIBS.hyparquet), import(LIBS.compressors)])
  .then(([hp, c]) => ({ ...hp, compressors: c.compressors })))

const manifests = new Map()   // dir -> Promise<rows>
const footers = new Map()     // url -> Promise<{ file, metadata, rowStarts }>

export async function readWhole(url, columns) {
  const { parquetMetadata, parquetReadObjects, compressors } = await libs()
  const res = await fetchRetry(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const file = await res.arrayBuffer()
  return parquetReadObjects({ file, metadata: parquetMetadata(file), columns, compressors })
}

function manifest(dir) {
  if (!manifests.has(dir)) manifests.set(dir, readWhole(dir + 'manifest.parquet'))
  return manifests.get(dir)
}
function footer(url, byteLength) {
  if (!footers.has(url)) footers.set(url, (async () => {
    const { asyncBufferFromUrl, parquetMetadataAsync } = await libs()
    const file = await asyncBufferFromUrl({ url, byteLength, fetch: fetchRetry })
    const metadata = await parquetMetadataAsync(file)
    const rowStarts = []; let r = 0
    for (const rg of metadata.row_groups) { rowStarts.push(r); r += Number(rg.num_rows) }
    return { file, metadata, rowStarts }
  })())
  return footers.get(url)
}

// run tasks with a concurrency limit
async function pool(tasks, limit = 6) {
  const out = new Array(tasks.length); let i = 0
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; out[k] = await tasks[k]() }
  }))
  return out
}

// rows (as objects) of a manifest-indexed table for the given IDs, in table order (sorted by ID, then bookID)
export async function readByIds(dir, ids, columns, onProgress) {
  const { parquetReadObjects, compressors } = await libs()
  const sorted = [...new Set(ids)].sort((a, b) => a - b)
  if (!sorted.length) return []
  const idSet = new Set(sorted)
  const covers = (lo, hi) => { let a = 0, b = sorted.length; while (a < b) { const m = (a + b) >> 1; if (sorted[m] < lo) a = m + 1; else b = m } return a < sorted.length && sorted[a] <= hi }
  const man = await manifest(dir)
  const jobs = []
  for (const m of man) {
    if (!covers(Number(m.id_min), Number(m.id_max))) continue
    const url = dir + m.file
    const { file, metadata, rowStarts } = await footer(url, Number(m.bytes))
    metadata.row_groups.forEach((rg, k) => {
      const st = rg.columns[0].meta_data.statistics            // column 0 = ID
      if (covers(Number(st.min_value), Number(st.max_value))) jobs.push({ file, metadata, rowStart: rowStarts[k], rowEnd: rowStarts[k] + Number(rg.num_rows) })
    })
  }
  let done = 0
  const parts = await pool(jobs.map(j => async () => {
    const rows = await parquetReadObjects({ file: j.file, metadata: j.metadata, rowStart: j.rowStart, rowEnd: j.rowEnd, columns, compressors })
    done++; onProgress?.(done, jobs.length)
    return rows.filter(r => idSet.has(r.ID))
  }))
  return parts.flat()
}

// all data the result views need besides the per-search rows; loaded once per session
let staticData
export function loadStatic(base) {
  return (staticData ??= (async () => {
    const [books, frozen, urls, mainData, compsLabels, typesFinal, bookLinks] = await Promise.all([
      readWhole(base + 'data_BC/metadata_books.parquet', ['bookID', 'bookURI', 'tok_length', 'CLEAN']),
      readWhole(base + 'data/metadata_bookID_bookURI_frozen.parquet'),
      readWhole(base + 'data_BC/metadata_books_urls.parquet'),
      readWhole(base + 'data_BC/main_data.parquet'),
      readWhole(base + 'data_BC/comps_labels.parquet'),
      fetchRetry(base + 'data_BC/types_final.tsv').then(r => r.text()).then(parseTSV),
      fetchRetry(base + 'derived/book_links.tsv').then(r => r.text()).then(parseTSV),   // release-pinned book paths
    ])
    return { books, frozen, urls, mainData, compsLabels, typesFinal, bookLinks }
  })())
}
function parseTSV(text) {
  const [head, ...rows] = text.replace(/\r/g, '').trim().split('\n')
  const cols = head.split('\t')
  return rows.map(l => Object.fromEntries(l.split('\t').map((v, i) => [cols[i], v])))
}
