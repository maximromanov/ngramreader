// Data source configuration: the only place that names a data release.
// To switch releases, change DEFAULT_RELEASE (or add an entry and point DEFAULT_RELEASE to it). A later
// release selector would list RELEASES; v1 has none. A URL-state link carries release@commit, so old links
// keep reading the data commit they were made with.
export const RELEASES = {
  '2023.1.8': {
    release: '2023.1.8',                                   // OpenITI release
    repo: 'maximromanov/ngramreader-data-2023.1.8',         // GitHub data repository
    commit: '8c89e50e2a646530f05c33a12055268e864d75d0',     // pinned data commit (Parquet data + derived files + labels + classifier/; same as the Book Classifier)
    vocabFormat: 'text',                                    // 'text' (derived/vocab_*; adopted, faster) or 'parquet' (data/data_*grams2up_HI)
  },
}
export const DEFAULT_RELEASE = '2023.1.8'

export const APP = {
  name: 'OpenITI NgramReader',
  version: 'static v1',
  repo: 'maximromanov/ngramreader',
  classifier: 'https://maximromanov.github.io/classifier/',   // book and author profiles (Book Classifier), linked from the tables
}

// pinned library versions (loaded from cdn.jsdelivr.net)
export const LIBS = {
  hyparquet: 'https://cdn.jsdelivr.net/npm/hyparquet@1.31.2/+esm',
  compressors: 'https://cdn.jsdelivr.net/npm/hyparquet-compressors@1.1.2/+esm',
  plotly: 'https://cdn.jsdelivr.net/npm/plotly.js-dist-min@4.1.1/plotly.min.js',
  fflate: 'https://cdn.jsdelivr.net/npm/fflate@0.7.5/+esm',
}

export function dataBase(rel) {
  return `https://raw.githubusercontent.com/${rel.repo}/${rel.commit}/`
}

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
  return base.commit.startsWith(short) ? base.commit : short   // raw.githubusercontent.com accepts full hashes; short ones only if they resolve
}
