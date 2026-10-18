// Downloads: TSV per table (UTF-8, header row, character fields and column names in double quotes, embedded
// quotes doubled, missing values as NA, numbers in shortest round-trip form) and "all data" as one zip with a
// README.txt, built in the browser (fflate).
import { LIBS } from './config.js'

const q = s => '"' + String(s).replace(/"/g, '""') + '"'
const cell = v => v === null || v === undefined || (typeof v === 'number' && Number.isNaN(v)) ? 'NA'
  : typeof v === 'number' ? String(v) : q(v)

export function toTSV(rows, columns) {
  const cols = columns ?? Object.keys(rows[0] ?? {})
  return [cols.map(q).join('\t'), ...rows.map(r => cols.map(c => cell(r[c])).join('\t'))].join('\n') + '\n'
}

export function saveBlob(blob, filename) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}
export const saveText = (text, filename) => saveBlob(new Blob([text], { type: 'text/tab-separated-values;charset=utf-8' }), filename)

// files: { name: text }  -> zip blob
export async function zipFiles(files) {
  const { zipSync, strToU8 } = await import(LIBS.fflate)
  const entries = Object.fromEntries(Object.entries(files).map(([n, t]) => [n, strToU8(t)]))
  return new Blob([zipSync(entries, { level: 6 })], { type: 'application/zip' })
}

export const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
