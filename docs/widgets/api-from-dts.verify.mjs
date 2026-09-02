// Proves the list lands collapsed with every function on it, an entry opens on
// click, a #api-NAME hash opens that entry, the filter opens what matches and
// hides the rest, and a Try link lands its snippet in the playground.
export default async function verify({ routes, open, check, notes, waitForParse, statusText }) {
  for (const route of routes) {
    const page = await open(route, `api-from-dts:${route}`)
    const widget = '[data-widget="api-from-dts"]'
    await page.locator(widget).first().scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })
    const filterPlacement = await page.$eval(widget, (root) => {
      const groups = root.querySelector('[data-api-groups]')
      const toolbar = root.querySelector('.api-toolbar')
      const input = toolbar?.querySelector('[data-api-filter]')
      const count = toolbar?.querySelector('[data-api-count]')
      return {
        toolbarImmediatelyPrecedesGroups: Boolean(toolbar && groups && toolbar.nextElementSibling === groups),
        filterImmediatelyPrecedesCount: Boolean(input && count && input.closest('label')?.nextElementSibling === count),
        placeholder: input?.getAttribute('placeholder') ?? '',
        position: toolbar ? getComputedStyle(toolbar).position : '',
      }
    })
    check(filterPlacement.toolbarImmediatelyPrecedesGroups, `${route}: the filter toolbar is not directly above the API listing`)
    check(filterPlacement.filterImmediatelyPrecedesCount, `${route}: the match count is not beside the filter input`)
    check(filterPlacement.placeholder === 'Filter exports', `${route}: the filter placeholder reads "${filterPlacement.placeholder}"`)
    check(filterPlacement.position === 'sticky', `${route}: the filter toolbar position is ${filterPlacement.position || 'unset'}, not sticky`)
    const expectedFunctions = Number(await page.getAttribute(`${widget} [data-api-groups]`, 'data-api-functions'))
    const names = await page.$$eval(`${widget} [data-api-entry][data-api-kind="function"]`, (nodes) =>
      nodes.map((node) => node.dataset.apiName),
    )
    check(
      names.length === expectedFunctions && expectedFunctions >= 17,
      `${route}: ${names.length} function entries, build counted ${expectedFunctions} (17 shipped in 0.1.5)`,
    )
    for (const name of ['parse', 'parseModule', 'analyze', 'generate', 'walk']) {
      check(names.includes(name), `${route}: no entry for ${name}`)
    }
    const state = () =>
      page.$$eval(`${widget} [data-api-entry]`, (nodes) => ({
        total: nodes.length,
        open: nodes.filter((node) => node.open).map((node) => node.dataset.apiName),
        hidden: nodes.filter((node) => node.hidden).map((node) => node.dataset.apiName),
        briefs: nodes.filter((node) => !node.querySelector('summary .api-brief')?.textContent.trim()).length,
      }))

    // Landing: one closed line per export, nothing hidden, the groups open.
    const landing = await state()
    check(landing.open.length === 0, `${route}: entries open at rest: ${landing.open.join(', ')}`)
    check(landing.hidden.length === 0, `${route}: entries hidden at rest: ${landing.hidden.join(', ')}`)
    check(landing.briefs === 0, `${route}: ${landing.briefs} entries have no one-line brief in their summary`)
    const closedGroups = await page.$$eval(`${widget} [data-api-group]`, (nodes) => nodes.filter((node) => !node.open).length)
    check(closedGroups === 0, `${route}: ${closedGroups} groups closed at rest`)
    const listed = await page.$$eval(`${widget} ol.api-doc li, ${widget} ul.api-doc li`, (nodes) => nodes.length)
    check(listed >= 3, `${route}: doc-comment lists render ${listed} items, expected the three-step lang order`)
    const tryLinks = await page.$$eval(`${widget} [data-api-entry][data-api-kind="function"] .api-try a[href*="playground"]`, (nodes) =>
      nodes.map((node) => node.getAttribute('href')),
    )
    check(
      tryLinks.length === expectedFunctions && tryLinks.every((href) => /\/playground#code=/.test(href)),
      `${route}: ${tryLinks.length} Try links for ${expectedFunctions} functions`,
    )

    // A click on the line opens the signature under it.
    await page.click(`${widget} [data-api-entry][data-api-name="parse"] > summary`)
    const afterClick = await state()
    check(afterClick.open.length === 1 && afterClick.open[0] === 'parse', `${route}: clicking parse opened ${afterClick.open.join(', ') || 'nothing'}`)
    check(
      await page.locator(`${widget} [data-api-entry][data-api-name="parse"] .api-sig`).isVisible(),
      `${route}: the parse entry opened without its signature`,
    )

    // The filter opens what matches and hides the rest.
    await page.fill(`${widget} [data-api-filter]`, 'quotes')
    await page.waitForFunction(
      (root) => document.querySelectorAll(`${root} [data-api-entry][hidden]`).length > 0,
      widget,
      { timeout: 10_000 },
    )
    const filtered = await state()
    const visible = await page.$$eval(`${widget} [data-api-entry]:not([hidden])`, (nodes) =>
      nodes.map((node) => ({ name: node.dataset.apiName, open: node.open, text: node.textContent.toLowerCase() })),
    )
    check(visible.length < filtered.total, `${route}: filtering by "quotes" left every entry visible`)
    check(visible.every((entry) => entry.text.includes('quotes')), `${route}: a visible entry does not mention quotes: ${visible.map((entry) => entry.name).join(', ')}`)
    check(visible.every((entry) => entry.open), `${route}: a matching entry stayed closed: ${visible.filter((entry) => !entry.open).map((entry) => entry.name).join(', ')}`)
    check(visible.some((entry) => entry.name === 'GenerateOptions'), `${route}: GenerateOptions did not survive the quotes filter`)
    const filteredCount = (await page.textContent(`${widget} [data-api-count]`)).trim()
    check(filteredCount.startsWith(`${visible.length} of ${filtered.total}`), `${route}: the count reads ${filteredCount}`)
    await page.fill(`${widget} [data-api-filter]`, '')
    await page.waitForFunction(
      (root) => document.querySelectorAll(`${root} [data-api-entry][hidden]`).length === 0,
      widget,
      { timeout: 10_000 },
    )
    const cleared = await state()
    check(cleared.open.length === 0, `${route}: clearing the filter left open: ${cleared.open.join(', ')}`)

    // A #api-NAME hash opens that entry and scrolls to it, so cross-page links land.
    const linked = await open(`${route}#api-generate`, `api-from-dts:${route}#api-generate`)
    await linked.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })
    const byHash = await linked.$$eval(`${widget} [data-api-entry]`, (nodes) => ({
      open: nodes.filter((node) => node.open).map((node) => node.dataset.apiName),
      top: nodes.find((node) => node.dataset.apiName === 'generate')?.getBoundingClientRect().top ?? -1,
    }))
    check(byHash.open.length === 1 && byHash.open[0] === 'generate', `${route}#api-generate opened ${byHash.open.join(', ') || 'nothing'}`)
    check(byHash.top >= 0 && byHash.top < 1000, `${route}#api-generate left the entry at ${Math.round(byHash.top)}px from the top`)
    await linked.close()

    await page.click(`${widget} [data-api-entry][data-api-name="parse"] > summary`)
    await page.click(`${widget} [data-api-entry][data-api-name="parse"] .api-try a[href*="playground"]`)
    await page.waitForURL(/\/playground#code=/, { timeout: 15_000 })
    await waitForParse(page)
    const loaded = await page.evaluate(() => document.querySelector('#demo-editor textarea')?.value ?? '')
    check(loaded.includes('@if (open)'), `${route}: the Try link for parse did not load its snippet into the playground`)
    notes.push(`api-from-dts on ${route}: ${landing.total} entries closed at rest, ${names.length} functions, ${listed} doc list items; parse snippet in the playground: ${await statusText(page)}`)
  }
}
