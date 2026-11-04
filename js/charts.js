// NgramReader charts, drawn with the shared chart kit (chartkit.js): style, in-chart captions, exports.
import { PERIODS_PLOT } from './compute.js'
import { smoothSeries } from './loess.js'
import { plot, styleOf, narrow, GRID, AXIS, MUTED } from './chartkit.js'

const AH2CE = ah => Math.round(ah - ah / 33 + 622)                       // R app: AH2CE()
const TICKS = Array.from({ length: 14 }, (_, i) => 100 * (i + 1))
const timeTicks = step => { const t = TICKS.filter(x => x % step === 0); return { tickvals: t, ticktext: t.map(x => `${x} AH<br>${AH2CE(x)} CE`) } }
// fewer two-line labels where 14 do not fit: on phones (every 300 years) and in the Paper export (every 200)
const timeAxis = (extra = {}) => ({ ...timeTicks(narrow() ? 300 : 100), tickmode: 'array', tickangle: 0, showgrid: false, linecolor: AXIS, range: [85, 1415], ...extra })
const PAPER_TICKS = { paper: { xaxis: timeTicks(200) } }
const smoothText = span => (span <= 0.1 ? 'no smoothing' : `LOESS span ${span}`)
export const axisTitle = (relative, span) => `${relative ? 'relative' : 'absolute'} frequency, ${smoothText(span)}`
const corpusBars = (tokens, yaxis) => ({ type: 'bar', x: PERIODS_PLOT, y: tokens, yaxis, marker: { color: 'rgba(0,0,0,0.07)' }, width: 21, hovertemplate: '%{x} AH: %{y:,} tokens in the corpus<extra></extra>', showlegend: false })

// Together: all lines in one chart; grey corpus bars on a hidden axis behind them
export async function overTimeTogether(el, series, { relative, span, corpus, caption, filename, aspect }) {
  const traces = corpus ? [corpusBars(corpus, 'y')] : []
  const yl = corpus ? 'y2' : 'y'
  series.forEach((s, i) => { const st = styleOf(s.index)
    traces.push({ x: PERIODS_PLOT, y: smoothSeries(PERIODS_PLOT, s.values, span), yaxis: yl, name: `<i>${s.userLabel}</i>`, type: 'scatter', mode: 'lines', line: { color: st.color, dash: st.dash, width: 2.4 },
      hovertemplate: `${s.userLabel}: %{y${relative ? ':.4%' : ':,.0f'}} at %{x} AH<extra></extra>` }) })
  const value = { title: { text: axisTitle(relative, span), font: { size: 12 } }, tickformat: relative ? '.3%' : ',', rangemode: 'tozero', gridcolor: GRID, zeroline: false, linecolor: AXIS }
  const layout = { aspect, exportPatch: PAPER_TICKS, margin: { l: 72, r: 16, b: 54 }, showlegend: series.length > 1, legendRoom: series.length > 1 ? (narrow() ? Math.ceil(series.length / 2) : 1) : 0, legend: { orientation: 'h', x: 0, y: 1, yanchor: 'bottom', font: { size: 13 } }, hovermode: 'closest', xaxis: timeAxis(), barmode: 'overlay' }
  if (corpus) { layout.yaxis = { visible: false, rangemode: 'tozero', fixedrange: true }; layout.yaxis2 = { ...value, overlaying: 'y', side: 'left' } } else layout.yaxis = value
  await plot(el, traces, layout, caption, filename)
}

const LABEL_LIFT = 9     // panel labels stand this far above their panel, and at the left edge of the title: the first sits where Together has its subtitle
// Separate: one panel per line, shared time axis; absolute counts as pale bars (left), relative frequency as a line (right)
export async function overTimeSeparate(el, panels, { span, corpus, caption, filename, aspect }) {
  const n = panels.length, gap = 0.34 / Math.max(n, 2) / (n > 1 ? 1 : 2), h = (1 - gap * (n - 1)) / n
  const traces = [], layout = { exportPatch: PAPER_TICKS, margin: { l: 84, r: 76, b: 54 }, showlegend: false, hovermode: 'closest', xaxis: timeAxis({ anchor: `y${3 * n - 1}` }), barmode: 'overlay', aspect, aspectScale: n / (1 - gap * (n - 1)), subRoom: 1, annotations: [] }
  panels.forEach((p, i) => {
    const top = 1 - i * (h + gap), dom = [top - h, top - (i === 0 ? 0 : 0)], st = styleOf(p.index)
    const a = 3 * i + 1, b = a + 1, c = a + 2, name = k => (k === 1 ? 'yaxis' : `yaxis${k}`), ref = k => (k === 1 ? 'y' : `y${k}`)
    if (corpus) traces.push(corpusBars(corpus, ref(c)))
    traces.push({ type: 'bar', x: PERIODS_PLOT, y: p.absolute, yaxis: ref(a), width: 21, marker: { color: `rgba(${st.rgb},0.24)` }, hovertemplate: `${p.userLabel}: %{y:,} occurrences at %{x} AH<extra></extra>` })
    traces.push({ type: 'scatter', mode: 'lines', x: PERIODS_PLOT, y: smoothSeries(PERIODS_PLOT, p.relative, span), yaxis: ref(b), line: { color: st.color, dash: st.dash, width: 2.4 }, hovertemplate: `${p.userLabel}: %{y:.4%} at %{x} AH<extra></extra>` })
    layout[name(c)] = { domain: dom, visible: false, rangemode: 'tozero', fixedrange: true, anchor: 'x' }
    layout[name(a)] = { domain: dom, overlaying: corpus ? ref(c) : undefined, side: 'left', anchor: 'x', rangemode: 'tozero', tickformat: ',.0f', nticks: 5, gridcolor: GRID, zeroline: false, linecolor: AXIS, tickfont: { size: 12, color: MUTED }, title: { text: 'absolute', font: { size: 12, color: MUTED } } }
    if (!corpus) delete layout[name(a)].overlaying
    layout[name(b)] = { domain: dom, overlaying: corpus ? ref(c) : ref(a), side: 'right', anchor: 'x', rangemode: 'tozero', tickformat: '.3%', showgrid: false, zeroline: false, linecolor: AXIS, tickfont: { size: 12, color: st.color }, title: { text: 'relative', font: { size: 12, color: st.color } } }
    layout.annotations.push({ text: `<b><i>${p.userLabel}</i></b>  ${p.detail}`, showarrow: false, xref: 'paper', yref: 'paper', x: 0, y: dom[1], xshift: 8 - layout.margin.l, yshift: LABEL_LIFT, xanchor: 'left', yanchor: 'bottom', align: 'left', font: { size: 13, color: st.color } })
  })
  // the time axis sits under the last panel
  const last = 3 * (n - 1) + 1; layout.xaxis.anchor = last === 1 ? 'y' : `y${last}`
  await plot(el, traces, layout, caption, filename)
}

// radar of book types (shares of hits), one layer per line; grey rings, scale 0-1 with the centre at -0.1
const ring = (theta, r, a) => ({ type: 'scatterpolar', r: theta.map(() => r), theta, fill: 'toself', fillcolor: `rgba(200,200,200,${a})`, line: { color: 'rgba(0,0,0,0)' }, mode: 'lines', hoverinfo: 'skip', showlegend: false })
export async function radarChart(el, compsTotal, lines, { caption, filename }) {
  const byType = (a, b) => (a.compsFinal < b.compsFinal ? -1 : a.compsFinal > b.compsFinal ? 1 : 0)     // code-point order, as in the classifier
  const axis = c => (narrow() ? c.replace(/ /g, '<br>').replace(/-/g, '-<br>') : c)                      // long names wrap on phones
  const layers = lines.map(L => { const rows = compsTotal.filter(r => r.label === L.label).sort(byType), st = styleOf(L.index)
    return { type: 'scatterpolar', r: rows.map(x => x.percentage), theta: rows.map(x => axis(x.compsFinal)), name: `<i>${L.userLabel}</i>`, fill: 'toself', fillcolor: `rgba(${st.rgb},0.3)`,
      line: { color: st.color, dash: st.dash, width: 2 }, marker: { color: st.color, size: 6 }, mode: 'lines+markers', hovertemplate: `%{theta}: %{r:.4f}<extra>${L.userLabel}</extra>` } }).filter(t => t.r.length > 1)
  const theta = layers[0]?.theta ?? []
  await plot(el, [ring(theta, 0.8, 0.2), ring(theta, 0.6, 0.4), ring(theta, 0.4, 0.6), ...layers], {
    margin: { b: 30, l: narrow() ? 75 : 40, r: narrow() ? 75 : 40 }, showlegend: true, legendRoom: narrow() ? Math.ceil(lines.length / 2) : 1, legend: { orientation: 'h', x: 0, y: 1.02, yanchor: 'bottom', font: { size: 13 } },
    polar: { domain: { x: [0, 1], y: [0, 0.96] }, radialaxis: { visible: true, range: [-0.1, 1], tickfont: { size: 11 } }, angularaxis: { tickfont: { size: narrow() ? 9 : 12 } } },
  }, caption, filename)
}

// book types over time for one line (R: NgramsCompsOverTimeWithGGPLOT): per type a ridge at its "order",
// height = freqsNorm / max(freqsNorm over all lines and types)
export async function typesOverTimeChart(el, compsPeriods, L, globalMax, { caption, filename, aspect }) {
  const rows = compsPeriods.filter(r => r.label === L.label), st = styleOf(L.index)
  const types = [...new Set(rows.map(r => r.compsFinal))]
  const traces = []
  for (const t of types) {
    const rr = rows.filter(r => r.compsFinal === t).sort((a, b) => a.periods - b.periods)
    const order = rr[0].order
    traces.push({ x: rr.map(r => r.periods), y: rr.map(() => order), type: 'scatter', mode: 'lines', line: { width: 0.5, color: '#999' }, hoverinfo: 'skip', showlegend: false })
    traces.push({ x: rr.map(r => r.periods), y: rr.map(r => order + (globalMax ? r.freqsNorm / globalMax : 0)), type: 'scatter', mode: 'lines',
      fill: 'tonexty', fillcolor: `rgba(${st.rgb},0.45)`, line: { color: st.color, width: 1 }, name: t, showlegend: false, text: rr.map(r => `${t}<br>${r.periods} AH: ${r.freqsNorm.toPrecision(3)}`), hoverinfo: 'text' })
  }
  const ticks = [...new Map(rows.map(r => [r.compsFinal, r.order])).entries()].sort((a, b) => a[1] - b[1])
  await plot(el, traces, { exportPatch: PAPER_TICKS, margin: { l: narrow() ? 90 : 240, r: 16, b: 54 }, aspect, xaxis: timeAxis(), yaxis: { tickvals: ticks.map(t => t[1]), ticktext: ticks.map(t => (narrow() ? t[0].slice(0, 3) : t[0])), zeroline: false, showgrid: false, fixedrange: true, tickfont: { size: 12 } }, showlegend: false, hovermode: 'closest' }, caption, filename)
}
