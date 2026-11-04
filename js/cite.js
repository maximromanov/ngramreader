// Citations of a result (shared by both apps; keep both copies the same) in Chicago, APA, BibTeX and RIS.
// c = { title (of the result, *…* = italics), app, version, doi, data, search, accessed (YYYY-MM-DD), link, key }
const plain = s => s.replace(/\*/g, '')
const bib = s => plain(s).replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1')
export const FORMATS = {
  chicago: { label: 'Chicago', html: true, make: c => `Romanov, Maxim. ${c.year}. “${c.title}.” In *${c.app}*, version ${c.version}. Zenodo. https://doi.org/${c.doi}. Data: ${c.data}. Search: ${c.search}. Accessed ${c.accessed}. ${c.link}.` },
  apa: { label: 'APA', html: true, make: c => `Romanov, M. (${c.year}). ${c.title}. In *${c.app}* (Version ${c.version}). Zenodo. https://doi.org/${c.doi}. Data: ${c.data}. Search: ${c.search}. Retrieved ${c.accessed}, from ${c.link}` },
  bibtex: { label: 'BibTeX', make: c => `@misc{${c.key},\n  author = {Romanov, Maxim},\n  title = {${bib(c.title)}},\n  howpublished = {In ${bib(c.app)}, version ${c.version}},\n  year = {${c.year}},\n  publisher = {Zenodo},\n  doi = {${c.doi}},\n  url = {${c.link.replace(/([#%])/g, '\\$1')}},\n  urldate = {${c.accessed}},\n  note = {Data: ${bib(c.data)}. Search: ${bib(c.search)}}\n}` },
  ris: { label: 'RIS', make: c => [['TY', 'DATA'], ['AU', 'Romanov, Maxim'], ['PY', c.year], ['TI', plain(c.title)], ['T2', c.app], ['ET', c.version], ['PB', 'Zenodo'], ['DO', c.doi], ['UR', c.link], ['Y2', c.accessed.replace(/-/g, '/')], ['N1', `Data: ${c.data}. Search: ${c.search}`], ['ER', '']].map(([k, v]) => `${k}  - ${v}`).join('\n') },
}
