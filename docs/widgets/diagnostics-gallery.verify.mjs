// The gallery's promise: every refused input shows its underline and message,
// the one warning reads as a warning, and the loose toggle recovers the
// unclosed element.
export default async function verify({ routes, open, check, notes }) {
  for (const route of routes) {
    const page = await open(route, `diagnostics-gallery:${route}`)
    const widget = '[data-widget="diagnostics-gallery"]'
    await page.locator(widget).first().scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })
    const cases = await page.$$eval(`${widget} [data-dg-case]`, (nodes) =>
      nodes.map((node) => ({
        id: node.dataset.dgCase,
        underlines: node.querySelectorAll('[data-dg-source] .wd-diag').length,
        warning: node.querySelectorAll('[data-dg-result] .wd-severity.wd-warning').length,
        result: node.querySelector('[data-dg-result]')?.textContent.trim() ?? '',
      })),
    )
    check(cases.length >= 10, `${route}: ${cases.length} gallery cases, expected at least 10`)
    for (const item of cases) {
      check(item.underlines > 0, `${route}: case ${item.id} has no underline`)
      check(item.result.length > 0, `${route}: case ${item.id} shows no message`)
    }
    const warning = cases.find((item) => item.id === 'redeclared')
    check(Boolean(warning) && warning.warning > 0, `${route}: the redeclaration case does not read as a warning`)

    const looseCase = `${widget} [data-dg-case="unclosed-element"]`
    const firstUnderline = page.locator(`${widget} [data-dg-case="if-braces"] [data-readout]`).first()
    await firstUnderline.focus()
    const focusedReadout = await page.textContent(`${widget} [data-dg-case="if-braces"] [data-dg-readout]`)
    check(focusedReadout.includes('Expected'), `${route}: focusing an underline did not show its diagnostic: ${focusedReadout}`)
    await page.locator(`${widget} [data-dg-loose]`).focus()
    await page.locator(`${widget} [data-dg-loose]`).press('Space')
    await page
      .waitForFunction(
        (selector) => (document.querySelector(`${selector} [data-dg-result]`)?.textContent ?? '').includes('0 diagnostics'),
        looseCase,
        { timeout: 15_000 },
      )
      .catch(() => check(false, `${route}: loose did not recover the unclosed element`))
    check(
      (await page.locator(`${looseCase} [data-dg-source] .wd-diag`).count()) === 0,
      `${route}: loose left an underline on the recovered element`,
    )
    check((await page.getAttribute(`${widget} [data-dg-loose]`, 'aria-checked')) === 'true', `${route}: recovery switch did not turn on`)
    await page.click(`${widget} [data-dg-loose]`)
    await page
      .waitForFunction(
        (selector) => document.querySelectorAll(`${selector} [data-dg-source] .wd-error`).length > 0,
        looseCase,
        { timeout: 15_000 },
      )
      .catch(() => check(false, `${route}: turning loose off did not bring the error back`))
    notes.push(`diagnostics-gallery on ${route}: ${cases.length} cases, ${(await page.textContent(`${widget} [data-widget-status]`)).trim()}`)
  }
}
