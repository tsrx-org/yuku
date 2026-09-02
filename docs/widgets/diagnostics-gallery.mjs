// `<!-- widget:diagnostics-gallery -->`, no fence. Every input below is one the
// parser refuses; each is parsed here so the gallery can never ship a case the
// engine has stopped rejecting, and the messages the reader sees come from the
// engine in the tab.

const CASES = [
  { id: 'if-braces', title: 'an @if body without braces', source: '@if (x) <b/>', expect: "Expected '{' after TSRX control-flow directive" },
  { id: 'for-braces', title: 'an @for body that used to disappear silently', source: 'const before = 1; const view = @for (const item of items) <li/>; const after = 2;', expect: "Expected '{' after TSRX control-flow directive" },
  { id: 'unknown-directive', title: 'a directive the dialect does not know', source: '@iffy (x) { <b/> }', expect: "Expected 'if' after '@'" },
  { id: 'switch-open', title: 'a @switch body that never closes', source: '@switch (x) { @case 1: { <b/> }', expect: "Expected '}' to close TSRX switch body" },
  { id: 'switch-break', title: 'a break inside a @case', source: '@switch (x) { @case 1: { break; } }', expect: '`break` is invalid inside `@switch` cases.' },
  { id: 'block-return', title: 'a return inside a template block', source: '<s>@{ return <b/>; }</s>', expect: '`return` is invalid inside TSRX template blocks' },
  { id: 'try-alone', title: 'a @try with neither @pending nor @catch', source: '@try { <b/> }', expect: "TSRX try directive requires '@pending' or '@catch'" },
  { id: 'dynamic-call', title: 'a dynamic tag that is a call', source: '<{getTag()} />', expect: 'TSRX dynamic tag expression must resolve to an element name' },
  { id: 'style-open', title: 'a <style> that never closes', source: '<s><style>.a{}</s>', expect: 'Unclosed TSRX style element' },
  { id: 'bare-at', title: 'a bare @ in text', source: '<p>mail @ home</p>', expect: "Expected '</' to close the JSX element, but found '@'" },
  { id: 'unclosed-element', title: 'an element closed by its parent’s tag', source: '<a><b>text</a>', expect: "Expected closing tag for '<b>' but found '</a>'", loose: true },
  { id: 'fragment-open', title: 'a fragment that never closes', source: '<>@if (x) { <b/> }', expect: "Expected '/' in JSX closing fragment, but found 'if'" },
  { id: 'redeclared', title: 'a name declared twice, with semanticErrors on', source: 'const a = 1; const a = 2;', semanticErrors: true, expect: "Identifier 'a' has already been declared", severity: 'warning' },
  { id: 'export-missing', title: 'an export of a name that does not exist, with semanticErrors on', source: 'export { nope };', semanticErrors: true, expect: "Export 'nope' is not defined" },
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
  const items = CASES.map(
    (item) => `<li class="dg-case" data-dg-case="${item.id}">
      <p class="dg-title">${ctx.escapeHtml(item.title)}</p>
      <div class="ex-source-host dg-source" data-dg-source><pre class="ex-source ex-source-plain"><code>${ctx.escapeHtml(item.source)}</code></pre></div>
      <div class="dg-result" data-dg-result></div>
      <p class="ex-readout" data-dg-readout aria-live="polite">Focus or hover the underline to read this diagnostic.</p>
    </li>`,
  ).join('\n')
  const payload = JSON.stringify(CASES.map(({ id, source, semanticErrors, loose }) => ({ id, source, semanticErrors: Boolean(semanticErrors), loose: Boolean(loose) }))).replaceAll('<', '\\u003c')
  return `<ol class="dg-list">${items}</ol>
  <div class="ex-controls ex-toolbar"><button type="button" role="switch" title="loose" data-dg-loose aria-checked="false" hidden>Allow recovery for the unclosed element</button></div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">the parser runs in your browser when this gallery scrolls into view; with JavaScript off the inputs stay as listed, without their messages</figcaption>
  <script type="application/json" data-dg-payload>${payload}</script>`
}

export function markdown() {
  return `On the site this is a gallery of ${CASES.length} inputs the parser refuses (${CASES.map((item) => `\`${item.source}\``).join(', ')}); each is parsed in your browser and shown with its underline, message and help line, and the unclosed-element case has a \`loose\` toggle.`
}
