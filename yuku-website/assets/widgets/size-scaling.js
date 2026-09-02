// Runtime half of yuku-website/widgets/size-scaling.mjs: repeats the fixture unit to a
// size, times parse() in this tab (median of a few runs), and plots the points.
import { formatMs, plural } from '../yuku-shared.js'
import { parse, ready } from '../yuku-wasm.js'
import { plainStatus } from './_shared.js'

const PARSE_OPTIONS = { lang: 'tsx', sourceType: 'module', semanticErrors: false }
const RUNS_PER_POINT = 3
const SVG = 'http://www.w3.org/2000/svg'
const WIDTH = 600
const HEIGHT = 260
const PAD = { top: 16, right: 20, bottom: 40, left: 56 }

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// Least squares through the points; slope is ms per KB.
function fitLine(points) {
  const n = points.length
  const sx = points.reduce((sum, p) => sum + p.kb, 0)
  const sy = points.reduce((sum, p) => sum + p.ms, 0)
  const sxx = points.reduce((sum, p) => sum + p.kb * p.kb, 0)
  const sxy = points.reduce((sum, p) => sum + p.kb * p.ms, 0)
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1)
  const intercept = sy / n - slope * (sx / n)
  return { slope, intercept }
}

function el(name, attrs = {}, text) {
  const node = document.createElementNS(SVG, name)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  if (text !== undefined) node.textContent = text
  return node
}

function niceStep(max, ticks) {
  const raw = max / ticks
  const power = 10 ** Math.floor(Math.log10(raw))
  for (const factor of [1, 2, 5, 10]) if (raw <= factor * power) return factor * power
  return 10 * power
}

function drawChart(host, points, fit) {
  const maxKb = Math.max(...points.map((p) => p.kb)) * 1.08
  const maxMs = Math.max(...points.map((p) => p.ms)) * 1.15 || 1
  const x = (kb) => PAD.left + (kb / maxKb) * (WIDTH - PAD.left - PAD.right)
  const y = (ms) => HEIGHT - PAD.bottom - (ms / maxMs) * (HEIGHT - PAD.top - PAD.bottom)
  const svg = el('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', class: 'ss-svg' })
  svg.append(el('title', {}, 'Parse time in milliseconds against source size in KB'))
  const stepKb = niceStep(maxKb, 5)
  for (let kb = 0; kb <= maxKb; kb += stepKb) {
    svg.append(el('line', { class: 'ss-grid', x1: x(kb), x2: x(kb), y1: PAD.top, y2: HEIGHT - PAD.bottom }))
    svg.append(el('text', { class: 'ss-tick', x: x(kb), y: HEIGHT - PAD.bottom + 16, 'text-anchor': 'middle' }, String(kb)))
  }
  const stepMs = niceStep(maxMs, 4)
  for (let ms = 0; ms <= maxMs; ms += stepMs) {
    svg.append(el('line', { class: 'ss-grid', x1: PAD.left, x2: WIDTH - PAD.right, y1: y(ms), y2: y(ms) }))
    svg.append(el('text', { class: 'ss-tick', x: PAD.left - 8, y: y(ms) + 4, 'text-anchor': 'end' }, formatMs(ms)))
  }
  svg.append(el('line', { class: 'ss-axis', x1: PAD.left, x2: WIDTH - PAD.right, y1: y(0), y2: y(0) }))
  svg.append(el('line', { class: 'ss-axis', x1: PAD.left, x2: PAD.left, y1: PAD.top, y2: y(0) }))
  svg.append(el('text', { class: 'ss-label', x: WIDTH - PAD.right, y: HEIGHT - 6, 'text-anchor': 'end' }, 'KB of source'))
  svg.append(el('text', { class: 'ss-label', x: PAD.left + 4, y: PAD.top + 4, 'text-anchor': 'start' }, 'ms per parse'))
  if (fit) {
    const x0 = 0
    const x1 = maxKb
    svg.append(
      el('line', {
        class: 'ss-fit',
        x1: x(x0),
        y1: y(Math.max(0, fit.intercept)),
        x2: x(x1),
        y2: y(fit.intercept + fit.slope * x1),
      }),
    )
  }
  for (const point of points) {
    const circle = el('circle', {
      class: point.user ? 'ss-point ss-point-user' : 'ss-point',
      cx: x(point.kb),
      cy: y(point.ms),
      r: 4.5,
      'data-ss-kb': Math.round(point.kb),
      tabindex: 0,
      'data-readout': `${Math.round(point.kb)} KB parsed in ${formatMs(point.ms)} ms with ${plural(point.nodes, 'node')}.`,
    })
    circle.append(el('title', {}, `${Math.round(point.kb)} KB: ${formatMs(point.ms)} ms, ${plural(point.nodes, 'node')}`))
    svg.append(circle)
  }
  host.replaceChildren(svg)
}

export default function mount(root, { cleanup }) {
  const { unit, sweep, unitBytes } = JSON.parse(root.querySelector('[data-ss-unit]').textContent)
  const slider = root.querySelector('[data-ss-size]')
  const sizeLabel = root.querySelector('[data-ss-size-label]')
  const runButton = root.querySelector('[data-ss-run]')
  const chart = root.querySelector('[data-ss-chart]')
  const status = root.querySelector('[data-widget-status]')
  const readout = root.querySelector('[data-ss-readout]')
  const points = []
  let disposed = false
  cleanup.push(() => {
    disposed = true
  })

  const say = (text) => {
    if (status) status.textContent = text
  }

  const textFor = (kb) => {
    const reps = Math.max(1, Math.round((kb * 1024) / unitBytes))
    return Array.from({ length: reps }, () => unit).join('\n')
  }

  async function measure(kb, user) {
    const text = textFor(kb)
    const bytes = new TextEncoder().encode(text).length
    const runs = []
    let nodes = 0
    for (let i = 0; i < RUNS_PER_POINT; i++) {
      const result = await parse(text, PARSE_OPTIONS)
      runs.push(result.ms)
      nodes = result.nodeCount
    }
    return { kb: bytes / 1024, bytes, ms: median(runs), nodes, user }
  }

  function redraw() {
    const fit = points.length >= 2 ? fitLine(points) : null
    drawChart(chart, points, fit)
    if (!fit) return
    plainStatus(root, `${plural(points.length, 'size')} form a ${fit.slope.toFixed(3)} ms-per-KB line.`, points.at(-1)?.ms)
  }

  slider.addEventListener('input', () => {
    sizeLabel.textContent = `${slider.value} KB`
  })
  const showPoint = (target) => {
    const point = target.closest?.('[data-readout]')
    if (point) readout.textContent = point.dataset.readout
  }
  chart.addEventListener('mouseover', (event) => showPoint(event.target))
  chart.addEventListener('focusin', (event) => showPoint(event.target))
  chart.addEventListener('click', (event) => showPoint(event.target))

  let busy = false
  runButton.addEventListener('click', async () => {
    if (busy) return
    busy = true
    runButton.disabled = true
    const kb = Number(slider.value)
    say(`parsing ${kb} KB…`)
    try {
      const point = await measure(kb, true)
      if (disposed) return
      points.push(point)
      redraw()
    } catch (error) {
      say(`parse failed: ${error.message}`)
      root.dataset.widgetState = 'error'
    } finally {
      busy = false
      runButton.disabled = false
    }
  })

  ready()
    .then(async () => {
      say(`sweeping ${sweep.join(', ')} KB…`)
      await parse(textFor(sweep[0]), PARSE_OPTIONS)
      for (const kb of sweep) {
        if (disposed) return
        points.push(await measure(kb, false))
        redraw()
      }
      runButton.disabled = false
      root.dataset.widgetState = 'ready'
    })
    .catch((error) => {
      chart.innerHTML = `<p class="ex-note ex-unavailable">in-browser parser unavailable</p>`
      say(`in-browser parser unavailable: ${error.message}`)
      root.dataset.widgetState = 'unavailable'
    })
}
