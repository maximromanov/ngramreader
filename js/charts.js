// Charts (plotly.js, loaded on first use). Legends show only the user's label; the full search (regex and
// ticked forms) is given in a caption under each chart. Each chart can be saved as SVG or PNG.
import { LIBS } from './config.js'
import { PERIODS_PLOT } from './compute.js'
import { smoothSeries } from './loess.js'

let plotlyPromise
export const loadPlotly = () => (plotlyPromise ??= new Promise((resolve, reject) => {
  if (window.Plotly) return resolve(window.Plotly)
  const s = document.createElement('script'); s.src = LIBS.plotly; s.onload = () => resolve(window.Plotly); s.onerror = reject
  document.head.appendChild(s)
}))

const AH2CE = ah => Math.round(ah - ah / 33 + 622)                       // R app: AH2CE()
const TICKS = Array.from({ length: 15 }, (_, i) => 100 * i)               // R: seq(0, 1500, 100) shown on 100..1400
const xaxis = title => ({ tickvals: TICKS, ticktext: TICKS.map(t => `${t} AH<br>${AH2CE(t)} CE`), tickmode: 'array', title: { text: title, font: { size: 11 } }, automargin: true })
const DASH = ['solid', 'dash', 'dot', 'dashdot', 'longdash', 'longdashdot']
const COLORS = ['#1f3b73', '#b5432d', '#2e7d4f', '#7a4ea3', '#c08a00', '#3a8fb7', '#8c564b', '#e377c2', '#555555', '#17becf']
const font = { family: 'Georgia, "Times New Roman", serif', size: 13 }

function config(filename) {
  const save = format => ({
    name: `Download ${format.toUpperCase()}`, title: `Download ${format.toUpperCase()}`,
    icon: { width: 1000, height: 1000, path: 'M500 50 L500 700 M250 450 L500 700 L750 450 M150 900 L850 900', transform: '' },
    click: gd => window.Plotly.downloadImage(gd, { format, filename, width: Math.max(gd.offsetWidth, 900), height: Math.max(gd.offsetHeight, 500) }),
  })
  return { responsive: true, displaylogo: false, modeBarButtonsToRemove: ['toImage', 'lasso2d', 'select2d'],
           modeBarButtonsToAdd: [save('svg'), save('png')] }
}

// absolute or relative curves, one trace per search line
export async function chronoChart(el, series, { relative, span, filename, title }) {
  const Plotly = await loadPlotly()
  const traces = series.map((s, i) => ({
    x: PERIODS_PLOT, y: smoothSeries(PERIODS_PLOT, s.values, span), name: s.userLabel, type: 'scatter', mode: 'lines+markers',
    line: { color: COLORS[i % COLORS.length], dash: DASH[i % DASH.length], width: 2 }, marker: { size: 4 },
  }))
  const smooth = span <= 0.1 ? 'no smoothing' : `LOESS smoothing (span ${span})`
  await Plotly.react(el, traces, {
    font, title: { text: title, font: { size: 15 } }, margin: { t: 40, r: 10, l: 60, b: 70 }, legend: { orientation: 'h', y: 1.12 },
    xaxis: xaxis(''), yaxis: { title: { text: `${relative ? 'relative' : 'absolute'} frequency, ${smooth}`, font: { size: 11 } }, tickformat: relative ? '.4%' : null, rangemode: 'tozero' },
  }, config(filename))
}

// absolute and relative on two axes (one search line only, as in the R app)
export async function combinedChart(el, s, rel, { span, filename }) {
  const Plotly = await loadPlotly()
  const smooth = span <= 0.1 ? 'no smoothing' : `LOESS (${span})`
  await Plotly.react(el, [
    { x: PERIODS_PLOT, y: smoothSeries(PERIODS_PLOT, s.values, span), name: `${s.userLabel}: absolute`, type: 'scatter', mode: 'lines+markers', line: { color: COLORS[0], width: 2 }, marker: { size: 4 } },
    { x: PERIODS_PLOT, y: smoothSeries(PERIODS_PLOT, rel.values, span), name: `${s.userLabel}: relative`, type: 'scatter', mode: 'lines+markers', yaxis: 'y2', line: { color: COLORS[1], width: 2, dash: 'dot' }, marker: { size: 4 } },
  ], {
    font, title: { text: 'Absolute and relative frequencies', font: { size: 15 } }, margin: { t: 40, r: 70, l: 60, b: 70 }, legend: { orientation: 'h', y: 1.12 },
    xaxis: { ...xaxis(''), domain: [0, 0.92] }, yaxis: { title: { text: `absolute, ${smooth}`, font: { size: 11 } }, rangemode: 'tozero' },
    yaxis2: { title: { text: `relative, ${smooth}`, font: { size: 11 } }, overlaying: 'y', side: 'right', tickformat: '.4%', rangemode: 'tozero' },
  }, config(filename))
}

// radar of book types (shares of hits), one trace per line; type names abbreviated as in the R app
// same design as the Book Classifier's book radar (classifier js/charts.js): full type names on the axes, grey rings,
// filled layers, scale 0-1 with the centre at -0.1; one layer per search line
const RADAR_RGB = ['0,100,0', '255,0,0', '255,255,0', '31,59,115', '122,78,163', '192,138,0', '58,143,183', '140,86,75', '227,119,194', '85,85,85']
const ring = (theta, r, a) => ({ type: 'scatterpolar', r: theta.map(() => r), theta, fill: 'toself', fillcolor: `rgba(200,200,200,${a})`, line: { color: 'rgba(0,0,0,0)' }, mode: 'lines', hoverinfo: 'skip', showlegend: false })
export async function radarChart(el, compsTotal, lines, { filename }) {
  const Plotly = await loadPlotly()
  const byType = (a, b) => (a.compsFinal < b.compsFinal ? -1 : a.compsFinal > b.compsFinal ? 1 : 0)     // code-point order, as in the classifier
  const narrow = innerWidth < 600, axis = c => (narrow ? c.replace(/ /g, '<br>').replace(/-/g, '-<br>') : c)                 // long names wrap on phones
  const layers = lines.map((L, i) => {
    const rows = compsTotal.filter(r => r.label === L.label).sort(byType), rgb = RADAR_RGB[i % RADAR_RGB.length]
    return { type: 'scatterpolar', r: rows.map(x => x.percentage), theta: rows.map(x => axis(x.compsFinal)), name: L.userLabel, fill: 'toself', fillcolor: `rgba(${rgb},0.6)`,
             line: { color: `rgba(${rgb},0.6)` }, marker: { color: `rgb(${rgb})` }, mode: 'lines+markers', hovertemplate: `%{theta}: %{r:.4f}<extra>${L.userLabel}</extra>` }
  }).filter(t => t.r.length > 1)
  const theta = layers[0]?.theta ?? []
  await Plotly.react(el, [ring(theta, 0.8, 0.2), ring(theta, 0.6, 0.4), ring(theta, 0.4, 0.6), ...layers], {
    font, title: { text: 'Distribution over book types (share of hits)', font: { size: 15 } }, margin: { t: 50, b: 30, l: narrow ? 75 : 40, r: narrow ? 75 : 40 }, showlegend: true, legend: { orientation: 'h', y: -0.12 },
    polar: { radialaxis: { visible: true, range: [-0.1, 1] }, angularaxis: { tickfont: { size: narrow ? 9 : 12 } } },
  }, config(filename))
}

// book types over time for one line (R: NgramsCompsOverTimeWithGGPLOT): per type a ridge at its "order",
// height = freqsNorm / max(freqsNorm over all lines and types)
export async function typesOverTimeChart(el, compsPeriods, L, globalMax, { filename }) {
  const Plotly = await loadPlotly()
  const rows = compsPeriods.filter(r => r.label === L.label)
  const types = [...new Set(rows.map(r => r.compsFinal))]
  const traces = []
  for (const t of types) {
    const rr = rows.filter(r => r.compsFinal === t).sort((a, b) => a.periods - b.periods)
    const order = rr[0].order
    traces.push({ x: rr.map(r => r.periods), y: rr.map(() => order), type: 'scatter', mode: 'lines', line: { width: 0.5, color: '#999' }, hoverinfo: 'skip', showlegend: false })
    traces.push({ x: rr.map(r => r.periods), y: rr.map(r => order + (globalMax ? r.freqsNorm / globalMax : 0)), type: 'scatter', mode: 'lines',
                  fill: 'tonexty', fillcolor: 'rgba(46,125,79,0.45)', line: { color: '#333', width: 1 }, name: t, showlegend: false,
                  text: rr.map(r => `${t}<br>${r.periods} AH: ${r.freqsNorm.toPrecision(3)}`), hoverinfo: 'text' })
  }
  const ticks = [...new Map(rows.map(r => [r.compsFinal, r.order])).entries()].sort((a, b) => a[1] - b[1])
  await Plotly.react(el, traces, {
    font, title: { text: `Book types over time: ${escapeHTML(L.userLabel)}`, font: { size: 15 } }, margin: { t: 40, r: 10, l: 10, b: 70 },
    xaxis: { ...xaxis(''), range: [90, 1410] }, yaxis: { tickvals: ticks.map(t => t[1]), ticktext: ticks.map(t => t[0]), automargin: true, zeroline: false },
    height: 520,
  }, config(filename))
}
const escapeHTML = s => s.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))
