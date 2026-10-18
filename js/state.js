// URL state: the page URL encodes the whole search so that opening it reproduces the result exactly.
//   l = a search line (repeated, in order)
//   x = "<line number>:<excluded IDs>" for unticked forms (IDs in base 36, "." separated; repeated per line)
//   m = corpus mode: clean | all        s = smoothing span (0.1 = none)
//   d = data release@commit (results are reproduced against the same data commit)
export function encodeState({ lines, excluded, mode, span, release }) {
  const p = new URLSearchParams()
  lines.forEach(l => p.append('l', l))
  excluded.forEach((ids, i) => { if (ids && ids.size) p.append('x', `${i + 1}:${[...ids].sort((a, b) => a - b).map(n => n.toString(36)).join('.')}`) })
  p.set('m', mode); p.set('s', String(span)); p.set('d', `${release.release}@${release.commit}`)
  return p.toString()
}

export function decodeState(search) {
  const p = new URLSearchParams(search)
  const lines = p.getAll('l')
  const excluded = lines.map(() => new Set())
  for (const x of p.getAll('x')) {
    const [i, ids] = x.split(':'); const k = parseInt(i, 10) - 1
    if (k >= 0 && k < lines.length && ids) ids.split('.').forEach(t => { const n = parseInt(t, 36); if (Number.isFinite(n)) excluded[k].add(n) })
  }
  const span = parseFloat(p.get('s'))
  return { lines, excluded, mode: p.get('m') === 'all' ? 'all' : 'clean', span: Number.isFinite(span) ? Math.min(0.3, Math.max(0.1, span)) : 0.2, release: p.get('d') }
}
