// Typing transliterated labels without special keys: while the cursor is in the label of a search line (after the first
// "#", before the second), a letter that has special forms brings up a small row of them under the line. Tap or click one,
// or press Tab to step through them. Items after the second "#" are search patterns and are left alone.
// Letters of Maxim Romanov's scheme (Brill HdO 199), as used in the working labels.
const FORMS = { a: 'aāáã', i: 'iī', u: 'uū', t: 'tṭṯŧ', d: 'dḍḏ', h: 'hḥḫ', s: 'sṣš', z: 'zẓ', g: 'gġ', "'": "ʿʾ'" }
const variants = ch => { const low = ch.toLowerCase(), f = FORMS[low]; if (!f) { const k = Object.keys(FORMS).find(x => FORMS[x].includes(low)); return k ? [...FORMS[k]].map(c => (ch !== low ? c.toUpperCase() : c)) : null } return [...f].map(c => (ch !== low ? c.toUpperCase() : c)) }
const inLabel = (value, pos) => { const before = value.slice(0, pos); return before.startsWith('#') && before.indexOf('#', 1) < 0 }

let pop, target = null
function hide() { if (pop) pop.hidden = true; target = null }
function show(input) {
  const pos = input.selectionStart, ch = input.value[pos - 1], list = pos && input.selectionEnd === pos && inLabel(input.value, pos) ? variants(ch ?? '') : null
  if (!list) return hide()
  pop ??= Object.assign(document.body.appendChild(document.createElement('div')), { id: 'translit-pop', role: 'toolbar', ariaLabel: 'Special letters' })
  pop.innerHTML = list.map(c => `<button type="button" tabindex="-1" class="${c === ch ? 'on' : ''}">${c}</button>`).join('') + '<span>Tab</span>'
  const r = input.getBoundingClientRect()
  pop.hidden = false; pop.style.left = `${Math.max(4, r.left + scrollX)}px`; pop.style.top = `${r.bottom + scrollY + 3}px`
  target = input
  pop.querySelectorAll('button').forEach(b => {
    b.onpointerdown = e => e.preventDefault()              // keeps the focus and the phone keyboard in the input
    b.onclick = () => put(input, b.textContent)
  })
}
function put(input, c) {
  const pos = input.selectionStart
  input.value = input.value.slice(0, pos - 1) + c + input.value.slice(pos)
  input.setSelectionRange(pos, pos); input.focus(); show(input)
}
export function translitInput(input) {
  input.addEventListener('input', () => show(input))
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') return hide()
    if (e.key !== 'Tab' || target !== input || e.shiftKey) return
    e.preventDefault()
    const list = [...pop.querySelectorAll('button')].map(b => b.textContent), ch = input.value[input.selectionStart - 1]
    put(input, list[(list.indexOf(ch) + 1) % list.length])
  })
  input.addEventListener('blur', hide)
  for (const ev of ['click', 'keyup']) input.addEventListener(ev, e => { if (e.key === undefined || e.key.startsWith('Arrow')) hide() })
}
