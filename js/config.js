// Data source configuration: the only place that names a data release.
// To switch releases, change DEFAULT_RELEASE (or add an entry and point DEFAULT_RELEASE to it). A later
// release selector would list RELEASES; v1 has none. A URL-state link carries release@commit, so old links
// keep reading the data commit they were made with.
export const RELEASES = {
  '2023.1.8': {
    release: '2023.1.8',                                   // OpenITI release
    repo: 'maximromanov/ngramreader-data-2023.1.8',         // GitHub data repository
    commit: '8c89e50e2a646530f05c33a12055268e864d75d0',     // pinned data commit (Parquet data + derived files + labels + classifier/; same as the Book Classifier)
    pins: ['846e5f91f46b5a38fbde66b73dfdc4d6e235bf1c', '89acf91172a052cf25e15e8854a509a529bb1c08'],   // earlier pins: links keep a 7-character commit, resolved here (add the old pin when moving commit)
    vocabFormat: 'text',                                    // 'text' (derived/vocab_*; adopted, faster) or 'parquet' (data/data_*grams2up_HI)
  },
}
export const DEFAULT_RELEASE = '2023.1.8'

// Local development only: on localhost or a private network address a git-ignored js/config.local.js may point the app at a local data server
// ({ dataBase, commit, classifier }; see README, "Development"). On any other host this is never loaded.
export const DEV = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)
  ? await import('./config.local.js').then(m => m.default).catch(() => null) : null

export const APP = {
  name: 'OpenITI NgramReader',
  version: '2.0',
  repo: 'maximromanov/ngramreader',
  classifier: 'https://maximromanov.github.io/classifier/',   // book and author profiles (Book Classifier), linked from the tables
}

// citation of the app: Romanov, Maxim. *title*. Zenodo, released <released>. https://doi.org/<doi>.
export const CITATION = { version: '2', doi: '10.5281/zenodo.23985408', year: 2026, released: 'November 5, 2026', title: 'DHFAIS App{endix} 1: OpenITI NgramReader, Version 2 (based on OpenITI, Release ver. 2023.1.8)', data: 'OpenITI, release 2023.1.8, https://doi.org/10.5281/zenodo.10007820' }
export const classifierURL = () => DEV?.classifier ?? APP.classifier

// pinned library versions (loaded from cdn.jsdelivr.net)
export const LIBS = {
  hyparquet: 'https://cdn.jsdelivr.net/npm/hyparquet@1.31.2/+esm',
  compressors: 'https://cdn.jsdelivr.net/npm/hyparquet-compressors@1.1.2/+esm',
  plotly: 'https://cdn.jsdelivr.net/npm/plotly.js-dist-min@4.1.1/plotly.min.js',
  fflate: 'https://cdn.jsdelivr.net/npm/fflate@0.7.5/+esm',
}

export function dataBase(rel) {
  return DEV?.dataBase ?? `https://raw.githubusercontent.com/${rel.repo}/${rel.commit}/`
}
export const dataCommit = rel => DEV?.commit ?? rel.commit

// release from a "release@commit" token (URL state); unknown release or commit -> default entry
export function resolveRelease(token) {
  const def = RELEASES[DEFAULT_RELEASE]
  if (!token) return def
  const [release, commit] = token.split('@')
  const base = RELEASES[release]
  if (!base) return def
  return commit && /^[0-9a-f]{7,40}$/.test(commit) ? { ...base, commit: commit.length === 40 ? commit : expandCommit(base, commit) } : base
}
function expandCommit(base, short) {
  return [base.commit, ...(base.pins ?? [])].find(c => c.startsWith(short)) ?? short   // raw.githubusercontent.com accepts full hashes; short ones only if they resolve
}
