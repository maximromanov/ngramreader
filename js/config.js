// Data source configuration: the only place that names a data release.
// To switch releases, change DEFAULT_RELEASE (or add an entry and point DEFAULT_RELEASE to it). A later
// release selector would list RELEASES; there is none yet. A link carries its release; see resolveRelease.
export const RELEASES = {
  '2023.1.8': {
    release: '2023.1.8',                                   // OpenITI release
    repo: 'maximromanov/ngramreader-data-2023.1.8',         // GitHub data repository
    commit: '7b082fba49e1d1f1ce0cf115adb657208bb4dfa1',     // pinned data commit, the only commit of the data repository; same as the Book Classifier
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
  ...DEV?.libs,                                            // the offline package bundles its own copies
}

export function dataBase(rel) {
  return DEV?.dataBase ?? `https://raw.githubusercontent.com/${rel.repo}/${rel.commit}/`
}
export const dataCommit = rel => DEV?.commit ?? rel.commit

// release from a "release@commit" token (URL state): every link of a release opens on that release's current data. The commit in
// the token is not followed, because the data repository holds one commit; earlier commits gave the same numbers.
export const resolveRelease = token => RELEASES[String(token ?? '').split('@')[0]] ?? RELEASES[DEFAULT_RELEASE]
