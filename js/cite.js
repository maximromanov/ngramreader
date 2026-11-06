// Citations of a result (shared by both apps; keep both copies the same) in Chicago, APA, BibTeX and RIS.
// c = { title (of the result, *…* = italics), app, released, year, version, doi, data, search, accessed (YYYY-MM-DD), link, key }
const apaDate = d => { const [md, y] = d.split(', '); return `${y}, ${md}` }      // November 5, 2026 -> 2026, November 5
// asterisks of a search (\w*) are text, not italics: kept apart from the *…* markers until the citation is laid out
const lit = s => s.replace(/\*/g, '\uE002')
export const unlit = s => s.replace(/\uE002/g, '*')
const plain = s => s.replace(/\*/g, '')
const bib = s => plain(s).replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1')
export const FORMATS = {
  chicago: { label: 'Chicago', html: true, make: c => `Romanov, Maxim. “${c.title}.” In *${c.app}*. Zenodo, released ${c.released}. https://doi.org/${c.doi}. Data: ${c.data}. Search: ${lit(c.search)}. Accessed ${c.accessed}. ${c.link}.` },
  apa: { label: 'APA', html: true, make: c => `Romanov, M. (${apaDate(c.released)}). ${c.title}. In *${c.app}*. Zenodo. https://doi.org/${c.doi}. Data: ${c.data}. Search: ${lit(c.search)}. Retrieved ${c.accessed}, from ${c.link}` },
  bibtex: { label: 'BibTeX', make: c => `@misc{${c.key},\n  author = {Romanov, Maxim},\n  title = {${bib(c.title)}},\n  howpublished = {In ${bib(c.app)}},\n  year = {${c.year}},\n  publisher = {Zenodo},\n  doi = {${c.doi}},\n  url = {${c.link.replace(/([#%])/g, '\\$1')}},\n  urldate = {${c.accessed}},\n  note = {Data: ${bib(c.data)}. Search: ${unlit(bib(lit(c.search)))}}\n}` },
  ris: { label: 'RIS', make: c => [['TY', 'DATA'], ['AU', 'Romanov, Maxim'], ['PY', c.year], ['TI', plain(c.title)], ['T2', c.app], ['ET', c.version], ['PB', 'Zenodo'], ['DO', c.doi], ['UR', c.link], ['Y2', c.accessed.replace(/-/g, '/')], ['N1', `Data: ${c.data}. Search: ${c.search}`], ['ER', '']].map(([k, v]) => `${k}  - ${v}`).join('\n') },
}

// the citation inside a chart: Chicago, without the search lines (the chart's subtitle has them), with the data commit
export const chartCitation = (c, commit) => `<b>Cite as:</b> Romanov, Maxim. “${c.title}.” In *${c.app}*. Zenodo, released ${c.released}. https://doi.org/${c.doi}. Data: ${c.data} (data commit ${commit}). Accessed ${c.accessed}. ${c.link}.`.replace(/\*([^*]+)\*/g, '<i>$1</i>')
