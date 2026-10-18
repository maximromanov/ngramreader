// Search lines: parsing (as in the R app), Arabic input, ngram order, validation.
// Syntax: "#Label #item1 #item2 ...". Items are tokens or regular expressions in simplified Buckwalter;
// words of bigrams/trigrams are joined with "_". Items of one line are OR-ed into \b(item1|item2)\b.

// simplified Buckwalter, as used by the NgramReader data (R app www/BuckwalterSimplified.txt),
// plus Persian letters that occur in Arabic texts (ی, ک) and alif wasla (normalised to A in the data)
const AR2BW = {
  'ء': 'c', 'ا': 'A', 'إ': 'A', 'أ': 'A', 'آ': 'A', 'ٱ': 'A', 'ب': 'b', 'ة': 'o', 'ت': 't', 'ث': 'v', 'ج': 'j',
  'ح': 'H', 'خ': 'x', 'د': 'd', 'ذ': 'V', 'ر': 'r', 'ز': 'z', 'س': 's', 'ش': 'E', 'ص': 'S', 'ض': 'D', 'ط': 'T',
  'ظ': 'Z', 'ع': 'C', 'غ': 'g', 'ف': 'f', 'ق': 'q', 'ك': 'k', 'ل': 'l', 'م': 'm', 'ن': 'n', 'ه': 'h', 'ؤ': 'c',
  'و': 'w', 'ى': 'y', 'ئ': 'c', 'ي': 'y', 'ی': 'y', 'ک': 'k',
}
const HARAKAT_TATWEEL = /[ً-ٰٟۖ-ۭـ]/g   // harakat, Quranic marks, superscript alif, tatweel
const ARABIC = /[؀-ۿ]/

// Arabic letters in an item -> Buckwalter; regex metacharacters and Latin text pass unchanged;
// spaces between Arabic words become "_" (word separator of bigrams/trigrams)
export function arabicToBuckwalter(item) {
  if (!ARABIC.test(item)) return item
  let s = item.replace(HARAKAT_TATWEEL, '')
  s = s.replace(/([؀-ۿ\]\)?*+}])\s+(?=[؀-ۿ\[(])/g, '$1_')
  return [...s].map(ch => AR2BW[ch] ?? ch).join('')
}

// one line -> { label, userLabel, items, regex } with the R app's rules
// (spaces inside items are removed; a line with a single token searches that token)
export function parseLine(rawLine) {
  const line = rawLine.trim()
  const firstSplit = line.replace(/^#/, '').split('#')
  const userLabel = firstSplit[0].replace(/ +$/, '')
  // Arabic conversion happens per item, before the R app's space removal, so that spaces between Arabic
  // words can become "_"
  const rawItems = firstSplit.length > 1 ? firstSplit.slice(1) : firstSplit
  const items = rawItems.map(it => arabicToBuckwalter(it.trim())).map(it => it.replace(/ +/g, '')).filter(it => it !== '')
  const regex = `\\b(${items.join('|')})\\b`
  return { line, userLabel, items, regex, label: `${userLabel} (RE: ${items.join('|')})` }
}

export const orderOfItem = item => (item.match(/_/g) || []).length + 1

// validate all non-empty lines; returns { lines, order, errors[] }
export function validateLines(rawLines) {
  const errors = []
  const lines = []
  rawLines.forEach((raw, i) => {
    if (!raw || !raw.trim()) return
    const p = parseLine(raw)
    p.index = i
    if (p.items.length === 0) { errors.push(`Line ${i + 1} has no search item. Write items after the label, each starting with "#", e.g. #Baġdād #[wb]?bgdAd.`); return }
    const bad = p.items.filter(it => orderOfItem(it) > 3)
    if (bad.length) errors.push(`Line ${i + 1}: "${bad[0]}" has ${orderOfItem(bad[0]) - 1} underscores. Use "_" only between the words of a bigram (1 underscore) or trigram (2 underscores).`)
    try { new RegExp(p.regex) } catch (e) {
      errors.push(`Line ${i + 1} is not a valid regular expression: ${p.items.join(' | ')} (${e.message.replace(/^Invalid regular expression: /, '')}). Check brackets and parentheses.`)
    }
    p.orders = [...new Set(p.items.map(orderOfItem))]
    lines.push(p)
  })
  if (lines.length === 0 && errors.length === 0) errors.push('Please enter a search line, for example: #Baġdād #[wb]?bgdAd')
  const orders = [...new Set(lines.flatMap(l => l.orders))]
  if (orders.length > 1) {
    const name = n => ['unigrams', 'bigrams', 'trigrams'][n - 1] ?? `${n}-grams`
    const where = lines.map(l => `line ${l.index + 1}: ${l.orders.map(name).join(' and ')}`).join('; ')
    errors.push(`A search can use only one ngram length, but this one mixes ${orders.map(name).join(' and ')} (${where}). The number of "_" in each item sets its length: none = unigram, one = bigram, two = trigram. Split them into separate searches.`)
  }
  return { lines, order: orders.length === 1 ? orders[0] : null, errors }
}
