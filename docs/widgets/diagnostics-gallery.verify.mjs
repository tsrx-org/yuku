// The figure's promise: every refused input remains available as a plain-language
// chip, and selecting it updates the one source pane, underline, and readout.
// The warning stays a warning, and the recovery switch only belongs to the one
// case that loose mode can recover.
const CASES = [
  ['if-braces', '@if without braces', '@if (x) <b/>', 'error'],
  ['for-braces', '@for without braces', 'const before = 1; const view = @for (const item of items) <li/>; const after = 2;', 'error'],
  ['unknown-directive', 'unknown directive', '@iffy (x) { <b/> }', 'error'],
  ['switch-open', 'unclosed @switch', '@switch (x) { @case 1: { <b/> }', 'error'],
  ['switch-break', 'break in @case', '@switch (x) { @case 1: { break; } }', 'error'],
  ['block-return', 'return in template block', '<s>@{ return <b/>; }</s>', 'error'],
  ['try-alone', '@try without fallback', '@try { <b/> }', 'error'],
  ['dynamic-call', 'dynamic tag call', '<{getTag()} />', 'error'],
  ['style-open', 'unclosed <style>', '<s><style>.a{}</s>', 'error'],
  ['bare-at', 'bare @ in text', '<p>mail @ home</p>', 'error'],
  ['unclosed-element', 'mismatched closing tag', '<a><b>text</a>', 'error'],
  ['fragment-open', 'unclosed fragment', '<>@if (x) { <b/> }', 'error'],
  ['redeclared', 'redeclared name', 'const a = 1; const a = 2;', 'warning'],
  ['export-missing', 'missing export', 'export { nope };', 'error'],
]

export default async function verify({ routes, open, check, notes }) {
  for (const route of routes) {
    const page = await open(route, `diagnostics-gallery:${route}`)
    const widget = '[data-widget="diagnostics-gallery"]'
    await page.locator(widget).first().scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })

    check((await page.locator(`${widget} [data-dg-source]`).count()) === 1, `${route}: expected one source pane`)
    check((await page.locator(`${widget} [data-dg-readout]`).count()) === 1, `${route}: expected one diagnostic readout`)
    const chips = await page.$$eval(`${widget} [data-dg-case]`, (nodes) =>
      nodes.map((node) => ({ id: node.dataset.dgCase, label: node.textContent.trim() })),
    )
    check(JSON.stringify(chips) === JSON.stringify(CASES.map(([id, label]) => ({ id, label }))), `${route}: diagnostic chips changed: ${JSON.stringify(chips)}`)

    check((await page.getAttribute(`${widget} [data-dg-case="if-braces"]`, 'aria-selected')) === 'true', `${route}: first case is not selected on landing`)
    check((await page.textContent(`${widget} [data-dg-source]`)).trim() === CASES[0][2], `${route}: first source is not visible on landing`)
    check((await page.textContent(`${widget} [data-dg-readout]`)).includes("Expected '{'"), `${route}: first diagnostic is not visible on landing`)

    for (const [id, label, source, severity] of CASES) {
      await page.click(`${widget} [data-dg-case="${id}"]`)
      await page.waitForFunction(
        ([rootSelector, caseId, expectedSource]) => {
          const root = document.querySelector(rootSelector)
          return root?.querySelector(`[data-dg-case="${caseId}"]`)?.getAttribute('aria-selected') === 'true' && root.querySelector('[data-dg-source]')?.textContent.replace(/\s*end of file\s*$/, '').trim() === expectedSource
        },
        [widget, id, source],
        { timeout: 15_000 },
      )
      check((await page.locator(`${widget} [data-dg-source] .wd-diag`).count()) > 0, `${route}: ${label} has no underline`)
      check((await page.locator(`${widget} [data-dg-readout] .wd-${severity}`).count()) > 0, `${route}: ${label} does not read as ${severity}`)
      check((await page.textContent(`${widget} [data-dg-message]`)).trim().length > 0, `${route}: ${label} shows no message`)
      check((await page.textContent(`${widget} [data-dg-help]`)).trim().startsWith('help:'), `${route}: ${label} shows no help field`)
      check((await page.getAttribute(`${widget} [data-dg-loose]`, 'hidden')) === (id === 'unclosed-element' ? null : ''), `${route}: recovery switch visibility is wrong for ${label}`)
    }

    const underline = page.locator(`${widget} [data-dg-source] [data-readout]`).first()
    await underline.focus()
    check((await page.textContent(`${widget} [data-dg-readout]`)).includes("Export 'nope'"), `${route}: focusing the underline did not update the shared readout`)

    await page.click(`${widget} [data-dg-case="unclosed-element"]`)
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.getAttribute('aria-selected') === 'true',
      `${widget} [data-dg-case="unclosed-element"]`,
      { timeout: 15_000 },
    )
    await page.locator(`${widget} [data-dg-loose]`).focus()
    await page.locator(`${widget} [data-dg-loose]`).press('Space')
    await page.waitForFunction(
      (selector) => (document.querySelector(`${selector} [data-dg-readout]`)?.textContent ?? '').includes('0 diagnostics'),
      widget,
      { timeout: 15_000 },
    )
    check((await page.locator(`${widget} [data-dg-source] .wd-diag`).count()) === 0, `${route}: recovery left an underline behind`)
    check((await page.getAttribute(`${widget} [data-dg-loose]`, 'aria-checked')) === 'true', `${route}: recovery switch did not turn on`)
    await page.click(`${widget} [data-dg-loose]`)
    await page.waitForFunction(
      (selector) => document.querySelectorAll(`${selector} [data-dg-source] .wd-error`).length > 0,
      widget,
      { timeout: 15_000 },
    )
    notes.push(`diagnostics-gallery on ${route}: ${CASES.length} chips, one source pane, one readout, recovery verified`)
  }
}
