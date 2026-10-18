// Web Worker: loads an ngram order's vocabulary once per session (as a plain array of ngramTR strings, index =
// ID - 1) plus per-ID corpus totals (all texts, clean texts), and runs search regexes against it.
// Messages in:  { cmd: 'load', id, order, base, format }        format: 'text' | 'parquet'
//               { cmd: 'match', id, order, regex }
// Messages out: { id, ok, ... } ; progress: { id, progress: { loaded, total } }
const vocab = new Map()        // order -> { tr: string[], all: Int32Array, clean: Int32Array, stats }
const loading = new Map()      // order -> Promise

async function fetchText(url, id, onBytes) {
  const res = await fetch(url)                          // plain GET: cacheable by the browser
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const reader = res.body.getReader(); const chunks = []; let n = 0
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; onBytes(value.length) }
  const buf = new Uint8Array(n); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length }
  return new TextDecoder('utf-8').decode(buf)
}
async function fetchBuffer(url, onBytes) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const reader = res.body.getReader(); const chunks = []; let n = 0
  for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; onBytes(value.length) }
  const buf = new Uint8Array(n); let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length }
  return buf.buffer
}
const tsvManifest = text => text.trim().split('\n').slice(1).map(l => { const [file, idMin, idMax, lines, bytes] = l.split('\t'); return { file, idMin: +idMin, idMax: +idMax, lines: +lines, bytes: +bytes } })

async function load(order, base, format, id) {
  const t0 = performance.now(); let bytes = 0
  const onBytes = n => { bytes += n; postMessage({ id, progress: { bytes } }) }
  let tr = []
  let tDecode = 0
  if (format === 'text') {
    const man = tsvManifest(await fetchText(`${base}derived/vocab_${order}gram/manifest.tsv`, id, () => {}))
    for (const m of man) {
      const text = await fetchText(`${base}derived/vocab_${order}gram/${m.file}`, id, onBytes)
      const td = performance.now()
      const lines = text.split('\n'); if (lines[lines.length - 1] === '') lines.pop()
      if (lines.length !== m.lines) throw new Error(`vocabulary part ${m.file}: ${lines.length} lines, expected ${m.lines}`)
      tr = tr.length ? tr.concat(lines) : lines
      tDecode += performance.now() - td
    }
  } else {
    const { parquetMetadata, parquetRead } = await import('https://cdn.jsdelivr.net/npm/hyparquet@1.31.2/+esm')
    const { compressors } = await import('https://cdn.jsdelivr.net/npm/hyparquet-compressors@1.1.2/+esm')
    const dir = `${base}data/data_${order}grams2up_HI/`
    const manBuf = await fetchBuffer(dir + 'manifest.parquet', () => {})
    const man = []
    await parquetRead({ file: manBuf, metadata: parquetMetadata(manBuf), rowFormat: 'object', compressors, onComplete: rows => man.push(...rows) })
    for (const m of man) {
      const buf = await fetchBuffer(dir + m.file, onBytes)
      const td = performance.now()
      const cols = []
      await parquetRead({ file: buf, metadata: parquetMetadata(buf), columns: ['ngramTR'], compressors,
        onChunk: c => { if (c.columnName === 'ngramTR') cols.push(c) } })
      cols.sort((a, b) => a.rowStart - b.rowStart)
      for (const c of cols) for (const v of c.columnData) tr.push(v)
      tDecode += performance.now() - td
    }
  }
  const tVocab = performance.now()
  // per-ID corpus totals (derived text file): "all<TAB>clean" per line, line = ID
  const all = new Int32Array(tr.length), clean = new Int32Array(tr.length)
  const cman = tsvManifest(await fetchText(`${base}derived/counts_${order}gram/manifest.tsv`, id, () => {}))
  let i = 0
  for (const m of cman) {
    const text = await fetchText(`${base}derived/counts_${order}gram/${m.file}`, id, onBytes)
    let p = 0
    while (p < text.length) {
      const tab = text.indexOf('\t', p), nl = text.indexOf('\n', tab)
      all[i] = +text.slice(p, tab); clean[i] = +text.slice(tab + 1, nl < 0 ? text.length : nl); i++
      p = nl < 0 ? text.length : nl + 1
    }
  }
  if (i !== tr.length) throw new Error(`totals: ${i} lines for ${tr.length} vocabulary entries`)
  const stats = { order, format, entries: tr.length, bytes, vocabMs: Math.round(tVocab - t0), decodeMs: Math.round(tDecode), totalMs: Math.round(performance.now() - t0) }
  vocab.set(order, { tr, all, clean, stats })
  return stats
}

onmessage = async ({ data: msg }) => {
  const { id } = msg
  try {
    if (msg.cmd === 'load') {
      if (vocab.has(msg.order)) { postMessage({ id, ok: true, stats: { ...vocab.get(msg.order).stats, cached: true } }); return }
      if (!loading.has(msg.order)) loading.set(msg.order, load(msg.order, msg.base, msg.format, id).finally(() => loading.delete(msg.order)))
      const stats = await loading.get(msg.order)
      postMessage({ id, ok: true, stats })
    } else if (msg.cmd === 'match') {
      const v = vocab.get(msg.order); if (!v) throw new Error('vocabulary not loaded')
      const re = new RegExp(msg.regex)
      const t0 = performance.now()
      const ids = [], tr = [], all = [], clean = []
      for (let k = 0; k < v.tr.length; k++) if (re.test(v.tr[k])) { ids.push(k + 1); tr.push(v.tr[k]); all.push(v.all[k]); clean.push(v.clean[k]) }
      postMessage({ id, ok: true, ids, tr, all, clean, ms: Math.round(performance.now() - t0) })
    }
  } catch (e) { postMessage({ id, ok: false, error: String(e && e.message || e) }) }
}
