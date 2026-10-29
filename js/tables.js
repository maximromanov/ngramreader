// Paged, sortable tables (plain DOM). Click a column header to sort; pages of 25 rows.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const fmt = v => v === null || v === undefined ? '' : typeof v === 'number'
  ? (Number.isInteger(v) ? v.toLocaleString('en') : (Math.abs(v) < 0.01 && v !== 0 ? v.toExponential(3) : String(+v.toPrecision(6))))
  : String(v)

// viewport width without the vertical scrollbar, for the full-width table areas (.wide in app.css)
const setPageWidth = () => document.documentElement.style.setProperty('--page-w', document.documentElement.clientWidth + 'px')
setPageWidth(); addEventListener('resize', setPageWidth)

export function renderTable(container, rows, columns, { pageSize = 25, render = {}, rtl = [] } = {}) {
  let sortCol = null, sortDir = 1, page = 0
  const draw = () => {
    const data = sortCol === null ? rows : [...rows].sort((a, b) => {
      const x = a[sortCol], y = b[sortCol]
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''))) * sortDir
    })
    const pages = Math.max(1, Math.ceil(data.length / pageSize)); page = Math.min(page, pages - 1)
    const slice = data.slice(page * pageSize, (page + 1) * pageSize)
    container.innerHTML = `
      <div class="table-scroll"><table>
        <thead><tr>${columns.map(c => `<th data-col="${esc(c)}" class="${sortCol === c ? (sortDir > 0 ? 'asc' : 'desc') : ''}${typeof rows[0]?.[c] === 'number' ? ' num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
        <tbody>${slice.map(r => `<tr>${columns.map(c => `<td${rtl.includes(c) ? ' dir="rtl" lang="ar"' : ''}${typeof r[c] === 'number' ? ' class="num"' : ''}>${render[c] ? render[c](r[c], r) : esc(fmt(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table></div>
      <div class="pager"><button data-p="prev" ${page === 0 ? 'disabled' : ''}>‹ Previous</button>
        <span>rows ${data.length ? page * pageSize + 1 : 0}–${Math.min((page + 1) * pageSize, data.length)} of ${data.length.toLocaleString('en')}</span>
        <button data-p="next" ${page >= pages - 1 ? 'disabled' : ''}>Next ›</button></div>`
    container.querySelectorAll('th').forEach(th => th.onclick = () => {
      const c = th.dataset.col; if (sortCol === c) sortDir = -sortDir; else { sortCol = c; sortDir = typeof rows[0]?.[c] === 'number' ? -1 : 1 }; page = 0; draw()
    })
    container.querySelector('[data-p=prev]').onclick = () => { page--; draw() }
    container.querySelector('[data-p=next]').onclick = () => { page++; draw() }
  }
  draw()
}
export { esc, fmt }
