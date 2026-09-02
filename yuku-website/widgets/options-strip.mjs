// `<!-- widget:options-strip -->` followed by a ```tsrx fence. The fence is the
// seed; the chips flip `parse` options in the reader's tab. "Break it" swaps in
// BROKEN, which is parsed here so it is known to carry exactly one error with
// a help line.

const BROKEN = 'const label = @if (open) <b>open</b>;'

const LANGS = ['js', 'ts', 'jsx', 'tsx']
const FLAGS = ['loose', 'semanticErrors', 'attachComments']

export const className = 'explorer ex-figure'

export default async function render({ fence, ctx }) {
  if (!fence || fence.lang !== 'tsrx') {
    throw new Error('options-strip needs a ```tsrx fence right after its marker')
  }
  const seed = await ctx.parse(fence.code, { lang: 'tsx', semanticErrors: false })
  const seedErrors = seed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (seedErrors.length > 0) {
    throw new Error(`options-strip: the seed does not parse: ${seedErrors[0].message}`)
  }
  const broken = await ctx.parse(BROKEN, { lang: 'tsx', semanticErrors: false })
  const brokenErrors = broken.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
  if (brokenErrors.length !== 1 || !brokenErrors[0].help) {
    throw new Error(
      `options-strip: the break-it snippet must carry exactly one error with a help line, got ${brokenErrors.length}`,
    )
  }
  const langChips = LANGS.map(
    (lang) =>
      `<button type="button" title="lang=${lang}" data-os-lang="${lang}" aria-pressed="${lang === 'tsx'}">${lang.toUpperCase()}</button>`,
  ).join('')
  const flagLabels = { loose: 'Allow recovery', semanticErrors: 'Check names', attachComments: 'Attach comments' }
  const flagChips = FLAGS.map(
    (flag) => `<button type="button" role="switch" title="${flag}" data-os-flag="${flag}" aria-checked="false">${flagLabels[flag]}</button>`,
  ).join('')
  const payload = JSON.stringify({ seed: fence.code, broken: BROKEN, records: ctx.tsrxRecordTypes }).replaceAll(
    '<',
    '\\u003c',
  )
  return `<div class="projection-map-panes">
    <div class="projection-map-pane">
      <h3>Source</h3>
      <div class="ex-source-host" data-os-source>${fence.html}</div>
      <p class="ex-readout" data-os-readout aria-live="polite">Focus or hover an underline to read the diagnostic.</p>
    </div>
    <div class="projection-map-pane">
      <h3>What <code>parse</code> returns</h3>
      <div class="ex-out os-out" data-os-out><p class="ex-note">The parser runs when this widget scrolls into view.</p></div>
    </div>
  </div>
  <p class="os-call">This widget calls <code>parse</code>, never <code>parseModule</code>: nothing throws, every diagnostic lands in the list. The call it makes: <code data-os-call>parse(source, { lang: "tsx" })</code></p>
  <div class="ex-controls ex-toolbar" data-os-controls>
    <div class="ex-option-rows">
      <div class="ex-chip-group" role="group" aria-label="Language"><span class="ex-chip-label">Language</span>${langChips}</div>
      <div class="ex-chip-group" aria-label="Parse options"><span class="ex-chip-label">Options</span>${flagChips}</div>
      <div class="ex-chip-group" role="group" aria-label="Example"><button type="button" data-os-break>Show broken example</button></div>
      <button type="button" data-os-reset hidden>Reset source and options</button>
    </div>
  </div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">the parser runs in your browser when this widget scrolls into view; with JavaScript off this stays the listing above</figcaption>
  <script type="application/json" data-os-payload>${payload}</script>`
}

export function markdown() {
  return `On the site this example is an editor with chips for \`lang\` (${LANGS.join(', ')}), \`loose\`, \`semanticErrors\` and \`attachComments\`; each flip runs \`parse\` again in your browser and shows the node count, the diagnostics and the time, and "break it" swaps in \`${BROKEN}\` to show the underline and the help line.`
}
