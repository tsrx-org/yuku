// `<!-- widget:size-scaling sweep="16,64,128,256,512" max="1024" -->`: the
// parseable fixtures concatenated into one unit at build; the reader's tab
// repeats that unit to a size and times parse() on it. The doubled unit is
// parsed here so the seed can never be one the engine refuses.
import { readdir } from 'node:fs/promises'

const PARSE_OPTIONS = { lang: 'tsx', sourceType: 'module', semanticErrors: false }
const DEFAULT_SWEEP = '16,64,128,256,512'
const DEFAULT_MAX_KB = 1024
const STEP_KB = 8

const kbList = (raw) =>
  raw
    .split(',')
    .map((part) => Number(part.trim()))
    .filter((kb) => Number.isFinite(kb) && kb > 0)

export const className = 'explorer ex-figure'

export default async function render({ attrs, ctx }) {
  const dir = `${ctx.repoRoot}/test/parser/misc/tsrx`
  const files = (await readdir(dir))
    .filter((name) => name.endsWith('.tsrx') && !name.includes('invalid'))
    .sort()
  if (files.length === 0) throw new Error('size-scaling: no parseable fixtures under test/parser/misc/tsrx')
  const unit = (await Promise.all(files.map((name) => ctx.readFixture(name)))).join('\n')
  const doubled = await ctx.parse(`${unit}\n${unit}`, PARSE_OPTIONS)
  const errors = doubled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (errors.length > 0) {
    throw new Error(`size-scaling: the concatenated fixtures do not parse: ${errors[0].message}`)
  }
  const sweep = kbList(attrs.sweep ?? DEFAULT_SWEEP)
  const maxKb = Number(attrs.max ?? DEFAULT_MAX_KB)
  if (sweep.length < 2 || sweep.some((kb) => kb > maxKb)) {
    throw new Error(`size-scaling: sweep "${attrs.sweep}" needs at least two sizes, all at most ${maxKb} KB`)
  }
  const defaultKb = sweep[Math.floor(sweep.length / 2)]
  const unitBytes = new TextEncoder().encode(unit).length
  const payload = JSON.stringify({ unit, files, sweep, unitBytes }).replaceAll('<', '\\u003c')
  return `<div class="ss-chart" data-ss-chart><p class="ex-note">The parser runs a sweep of ${sweep.join(', ')} KB when this figure scrolls into view.</p></div>
  <p class="ex-readout" data-ss-readout aria-live="polite">Focus or hover a point to read its size and parse time.</p>
  <div class="ex-controls ex-toolbar ss-controls">
    <label class="ss-size">Size <input type="range" data-ss-size min="${STEP_KB}" max="${maxKb}" step="${STEP_KB}" value="${defaultKb}" aria-label="Source size in KB"> <output data-ss-size-label>${defaultKb} KB</output></label>
    <button type="button" data-ss-run disabled>Parse</button>
  </div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">the parser runs in your browser when this figure scrolls into view; with JavaScript off nothing is measured</figcaption>
  <script type="application/json" data-ss-unit>${payload}</script>`
}

export function markdown({ attrs }) {
  return `On the site this is an interactive figure: ${kbList(attrs.sweep ?? DEFAULT_SWEEP).join(', ')} KB of the test fixtures, concatenated, are parsed in your browser and the parse time is plotted against the byte count, with a slider to add a size of your own.`
}
