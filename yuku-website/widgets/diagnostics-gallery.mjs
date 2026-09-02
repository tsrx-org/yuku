// `<!-- widget:diagnostics-gallery -->`, no fence. Every input below is one the
// parser refuses; each is parsed here so the gallery can never ship a case the
// engine has stopped rejecting, and the messages the reader sees come from the
// engine in the tab.

const CASES = [
  { id: 'if-braces', label: '@if without braces', source: '@if (x) <b/>', expect: "Expected '{' after TSRX control-flow directive" },
  { id: 'for-braces', label: '@for without braces', source: 'const before = 1; const view = @for (const item of items) <li/>; const after = 2;', expect: "Expected '{' after TSRX control-flow directive" },
  { id: 'unknown-directive', label: 'unknown directive', source: '@iffy (x) { <b/> }', expect: "Expected 'if' after '@'" },
  { id: 'switch-open', label: 'unclosed @switch', source: '@switch (x) { @case 1: { <b/> }', expect: "Expected '}' to close TSRX switch body" },
  { id: 'switch-break', label: 'break in @case', source: '@switch (x) { @case 1: { break; } }', expect: '`break` is invalid inside `@switch` cases.' },
  { id: 'block-return', label: 'return in template block', source: '<s>@{ return <b/>; }</s>', expect: '`return` is invalid inside TSRX template blocks' },
  { id: 'try-alone', label: '@try without fallback', source: '@try { <b/> }', expect: "TSRX try directive requires '@pending' or '@catch'" },
  { id: 'dynamic-call', label: 'dynamic tag call', source: '<{getTag()} />', expect: 'TSRX dynamic tag expression must resolve to an element name' },
  { id: 'style-open', label: 'unclosed <style>', source: '<s><style>.a{}</s>', expect: 'Unclosed TSRX style element' },
  { id: 'for-tail', label: 'repeated loop index', source: 'const view = @for (const k in obj; index a; index b) { <b/> };', expect: "Expected unique 'index' then 'key' clauses in for-of expression" },
  { id: 'unclosed-element', label: 'mismatched closing tag', source: '<a><b>text</a>', expect: "Expected closing tag for '<b>' but found '</a>'", loose: true },
  { id: 'fragment-open', label: 'unclosed fragment', source: '<>@if (x) { <b/> }', expect: "Expected '/' in JSX closing fragment, but found 'if'" },
  { id: 'redeclared', label: 'redeclared name', source: 'const a = 1; const a = 2;', semanticErrors: true, expect: "Identifier 'a' has already been declared", severity: 'warning' },
  { id: 'export-missing', label: 'missing export', source: 'export { nope };', semanticErrors: true, expect: "Export 'nope' is not defined" },
]

export const className = 'explorer ex-figure'

export default async function render({ ctx }) {
  for (const item of CASES) {
    const result = await ctx.parse(item.source, { lang: 'tsx', semanticErrors: Boolean(item.semanticErrors) })
    const hit = result.diagnostics.find((diagnostic) => diagnostic.message.includes(item.expect))
    if (!hit) {
      throw new Error(`diagnostics-gallery: ${item.id} no longer reports "${item.expect}" (got ${result.diagnostics.map((d) => d.message).join('; ') || 'nothing'})`)
    }
    if (hit.severity !== (item.severity ?? 'error')) {
      throw new Error(`diagnostics-gallery: ${item.id} is a ${hit.severity} now, expected ${item.severity ?? 'error'}`)
    }
    if (item.loose) {
      const recovered = await ctx.parse(item.source, { lang: 'tsx', semanticErrors: false, loose: true })
      if (recovered.diagnostics.length !== 0) {
        throw new Error(`diagnostics-gallery: ${item.id} is no longer recovered by loose`)
      }
    }
  }
  const chips = CASES.map(
    (item, index) => `<button type="button" role="tab" data-dg-case="${item.id}" aria-selected="${index === 0}" aria-controls="dg-panel" tabindex="${index === 0 ? '0' : '-1'}">${ctx.escapeHtml(item.label)}</button>`,
  ).join('')
  const payload = JSON.stringify(CASES.map(({ id, label, source, semanticErrors, loose }) => ({ id, label, source, semanticErrors: Boolean(semanticErrors), loose: Boolean(loose) }))).replaceAll('<', '\\u003c')
  return `<div class="dg-chips" role="tablist" aria-label="Diagnostic cases">${chips}</div>
  <div class="dg-panel" id="dg-panel" role="tabpanel">
    <div class="ex-source-host dg-source" data-dg-source><pre class="ex-source ex-source-plain"><code>${ctx.escapeHtml(CASES[0].source)}</code></pre></div>
    <div class="dg-readout" data-dg-readout aria-live="polite"></div>
    <div class="ex-controls ex-toolbar dg-toolbar"><button type="button" role="switch" title="loose" data-dg-loose aria-checked="false" hidden>Allow recovery</button></div>
  </div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">the parser runs in your browser when this figure scrolls into view; with JavaScript off the first source stays visible without its underline or message</figcaption>
  <script type="application/json" data-dg-payload>${payload}</script>`
}

export function markdown() {
  return `On the site this is one interactive figure with chips for ${CASES.length} inputs the parser refuses (${CASES.map((item) => `\`${item.source}\``).join(', ')}); selecting a chip shows that source with its underline, message and help line, and the mismatched-closing-tag case has a \`loose\` toggle.`
}
