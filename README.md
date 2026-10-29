# OpenITI NgramReader — static v1

**https://maximromanov.github.io/ngramreader/**

The OpenITI NgramReader charts the chronological frequencies of words and phrases (uni-, bi- and trigrams) in the OpenITI corpus of premodern Arabic texts, much like the Google Ngram Viewer. Several forms of a word, or a whole class of terms, can be added together into one curve. The results are:
- absolute and relative frequencies in 25-year periods (AH, by the author's death date), with optional LOESS smoothing;
- distribution over book types, as a radar chart and over time;
- tables by century, book and author.

This version runs entirely in the browser. It is plain HTML, CSS and JavaScript on GitHub Pages, with no server process and no build step. It is a redesign of the R/Shiny NgramReader ("ADHFAIS APP{ENDIX} 1"). For the same search, it gives the same counts, frequencies and tables as the R app's 2026 Parquet version (see "Agreement with the R app" below).

## Data source and release

- **Release:** **OpenITI 2023.1.8**.
- **Data repository:** [`maximromanov/ngramreader-data-2023.1.8`](https://github.com/maximromanov/ngramreader-data-2023.1.8), read through `raw.githubusercontent.com`. The data is the R app's Parquet data, unchanged, plus a few derived files.
- **Pinned commit:** the app reads one commit of the data repository: **`846e5f91f46b5a38fbde66b73dfdc4d6e235bf1c`**.
- **Configuration:** the release, the data repository and the pinned commit are set in one place, `js/config.js` (`RELEASES`, `DEFAULT_RELEASE`). To switch to another release, add its entry there and point `DEFAULT_RELEASE` to it. A later release lives in its own repository, `ngramreader-data-<release>`.
- **Where it is shown:** the version line at the bottom of the page shows the app commit, the release and the data commit. So does the `README.txt` inside every download.

## How it works

1. **Search lines** use the existing syntax, `#Label #item1 #item2 …`:
   - Each line is one curve, and the matches of its items are added together.
   - There is no limit on the number of lines.
   - The ngram length is detected from the number of `_` in each item: none = unigram, one = bigram, two = trigram. A search mixing lengths is refused with an explanation.
   - Items typed in Arabic script are converted to the simplified Buckwalter transliteration of the data. Harakat and tatweel are removed, and spaces between Arabic words become `_`. Labels stay as typed.
2. **Vocabulary.** The vocabulary of the needed length is loaded once into a Web Worker, so the page stays responsive. It is a plain-text list with one transliterated form per line, where line number = form ID: `derived/vocab_{n}gram`. The worker also loads per-form corpus totals (`derived/counts_{n}gram`). Both are fetched as whole files, so the browser caches them.
   - **Download sizes:** unigrams 3 MB; bigrams and trigrams about 27 MB each (gzip-compressed in transfer).
   - **Reuse:** within a session they stay in memory; on a later visit they come from the browser cache.
3. **Match preview.** Each line's regular expression runs over the vocabulary. The matching forms are listed with their Arabic script and corpus count; the list is sortable, filterable and paged. **Only ticked forms are counted.**
4. **Per-book counts.** These are read only for the ticked forms, from the Parquet files:
   - The `manifest.parquet` of each table selects the parts whose ID range covers the forms.
   - Inside those parts, the row-group statistics select the row groups.
   - Those row groups are fetched with HTTP range requests (`Range` is the only request header sent, so browsers need no CORS preflight).
   - The Arabic strings of the matched forms are read the same way.
5. **Results.** The tables follow the R app's definitions exactly (`js/compute.js`): periods, relative frequencies with the corpus-specific denominators, century table, books table with book types (`compsPrelim`, `compsValue`, `compsFinal`, "undefined" below 0.5), authors table, and book types over time.
   - **Smoothing** reimplements R's `loess` as the R app uses it: degree 2, gaussian family, the interpolated k-d-tree surface (`js/loess.js`). It agrees with R to about 1e-13 relative.
   - **Empty views:** a view with no data for the current search is hidden.
6. **URL state.** The page address holds the whole search, so opening it reproduces the result against the same data commit:
   - the lines;
   - the unticked forms, as base-36 IDs per line;
   - the corpus mode;
   - the smoothing span;
   - the data release and commit.
7. **Downloads.** Each table can be downloaded as a TSV, and "all data" as one zip with a `README.txt` (built in the browser). The README records the search lines, the ticked forms, the corpus mode, the release, the data commit, the app commit and the date.
   - **TSV format:** UTF-8, a header row, character fields in double quotes, embedded quotes doubled, `NA` for missing values.
   - **Charts** download as SVG or PNG from their toolbar.
8. **Book links** open the book's primary version in the frozen OpenITI release: `OpenITI/RELEASE`, tag `v2023.1.8`, file `derived/book_links.tsv` in the data repository.
   - 8,348 of 8,468 books have such a link.
   - For the other 120, which are not listed under the same URI in the release metadata, the R app's link to the GitHub `master` branch is used when one exists.

## Regular expressions

Items are **JavaScript** regular expressions. The R app used ICU, through `stringr`. Each line becomes `\b(item1|item2|…)\b`, matched against transliterations made only of `A–Z`, `a–z` and `_`. On such strings these behave as in the R app:
- `\w`, `\b`, `.`, `[…]`, `?`, `*`, `+`, `{m,n}`, `(…)`, `|`, `^`, `$`.

Differences:

| Construct | R app (ICU) | This app (JavaScript) |
|---|---|---|
| Possessive quantifiers `a++`, `a*+` | supported | syntax error, shown as a readable message |
| Atomic groups `(?>…)` | supported | syntax error, shown as a readable message |
| Quoting `\Q…\E` | supported | refused with a message (JavaScript would silently read `\Q` and `\E` as the letters Q and E) |
| Inline flags `(?i)`, `(?x)` | supported | syntax error, shown as a readable message |
| `\w` and `\b` on non-ASCII text | Unicode-aware | ASCII only; irrelevant here, since the vocabulary is ASCII |
| POSIX classes `[[:alpha:]]` | supported | refused with a message (JavaScript would silently read it as a set of the characters `[`, `:`, `a`, `l`, `p`, `h`) |
| Lookahead / lookbehind `(?=…)`, `(?<=…)` | supported | supported; note that each line is wrapped in `\b(…)\b`, so a lookaround at the edge of an item meets a word boundary |

Matching is case-sensitive in both, so `s` (س) is not `S` (ص). Spaces inside items are ignored, as in the R app.

## Agreement with the R app

The reference is the R app's 2026 Parquet version, run on the same data. Verified on nine benchmark searches in both corpus modes, the following are **identical**:
- the matched IDs;
- per-book counts;
- absolute and relative frequencies;
- the century, books, authors and book-type tables.

The LOESS curves agree within about 1e-13. Three deliberate differences remain:
- **Book links** point to the frozen release (above), not to GitHub `master`.
- **The same form in two search lines.** When one form matches in two lines, R duplicates its per-book rows; here each line counts it once.
- **Zero rows in the book-type table.** R gives the zero rows of types without hits only to the first search line; here every line gets them. The non-zero values are the same.

## Libraries

All are loaded from `cdn.jsdelivr.net` at pinned versions (`js/config.js`):

| Library | Version | Used for |
|---|---|---|
| `hyparquet` | 1.31.2 | Parquet reading |
| `hyparquet-compressors` | 1.1.2 | zstd decompression |
| `plotly.js-dist-min` | 4.1.1 | charts |
| `fflate` | 0.7.5 | building the zip |

## Citation

`[to be updated]` Maxim Romanov. (2023) *ADHFAIS App[endice]s* (OpenITI RELEASE Version 2023.1.8 [CLEAN]). [Software + Data set]. Zenodo: http://doi.org/...

**Acknowledgements:** Early versions of the NgramReader were developed within the KITAB Project, funded by ERC Consolidator Grant (#772989, 2018–2023); the current version has been developed within the framework of the EIS1600 Project, funded by DFG through the Emmy Noether Programm.

## License

The code of this app is released under the MIT License; see [`LICENSE`](LICENSE). The data, in [`ngramreader-data-2023.1.8`](https://github.com/maximromanov/ngramreader-data-2023.1.8), are derived from OpenITI release 2023.1.8 (https://doi.org/10.5281/zenodo.10007820) and are under CC BY-NC-SA 4.0.
