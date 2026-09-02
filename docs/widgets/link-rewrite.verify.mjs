export default async function verify({ routes, open, check, notes }) {
  const widget = '[data-widget="link-rewrite"]'
  for (const route of routes) {
    const label = `link-rewrite:${route}`
    const page = await open(route, label)
    await page.locator(widget).scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })

    const status = await page.textContent(`${widget} [data-widget-status]`)
    const landing = await page.textContent(`${widget} [data-lr-generated]`)
    check(/2 links rewritten/.test(status), `${label}: landing status is not two rewrites: ${status}`)
    check((landing.match(/url\(/g) ?? []).length === 2, `${label}: landing output does not contain two url() calls`)
    check(landing.includes('href="/pricing"'), `${label}: the static Link path did not stay a string`)
    check(landing.includes('<a href="/about">'), `${label}: the plain anchor changed`)

    const editor = page.locator(`${widget} textarea[aria-label="Editable TSRX link source"]`)
    const edited = (await editor.inputValue()).replace('/users/:id', '/members/:id')
    await editor.fill(edited)
    await page.waitForFunction(
      (selector) => document.querySelector(`${selector} [data-lr-generated]`)?.textContent.includes('/members/:id'),
      widget,
      { timeout: 15_000 },
    )
    const afterEdit = await page.textContent(`${widget} [data-lr-generated]`)
    check(afterEdit.includes('url("/members/:id"'), `${label}: editing href did not change the rewritten call`)
    const changed = await page.$$eval(`${widget} .lr-change`, (nodes) => ({
      ranges: new Set(nodes.flatMap((node) => node.dataset.range.split(' '))).size,
      text: nodes.map((node) => node.textContent).join(''),
    }))
    check(changed.ranges === 2 && changed.text.includes('/members/:id'), `${label}: changed spans are not highlighted`)
    await page.locator(`${widget} .lr-change[data-readout]`).first().focus()
    const readout = await page.textContent(`${widget} [data-lr-readout]`)
    check(readout.includes('href became'), `${label}: focusing a rewrite did not explain it: ${readout}`)
    const highlightedLayer = page.locator(`${widget} .ex-editor-layer .ex-source[aria-hidden="true"]`)
    check((await highlightedLayer.count()) === 1, `${label}: editable source has no highlighted layer`)
    check(
      (await highlightedLayer.locator('[style*="--shiki-light"]').count()) > 0,
      `${label}: highlighted layer has no token spans after editing`,
    )
    check(
      (await highlightedLayer.textContent()).includes('/members/:id'),
      `${label}: highlighted layer did not follow the edit`,
    )

    check(await page.locator(`${widget} [data-lr-reset]`).isVisible(), `${label}: Reset did not appear after editing`)
    await page.click(`${widget} [data-lr-reset]`)
    check((await editor.inputValue()).includes('/users/:id'), `${label}: Reset did not restore the source`)
    await editor.fill('const nav = <nav>')
    await page.waitForSelector(`${widget}[data-widget-state="error"] [data-lr-diagnostics]`, { timeout: 15_000 })
    const diagnostic = await page.textContent(`${widget} [data-lr-diagnostics]`)
    check(diagnostic.trim().length > 0, `${label}: broken source showed no diagnostic`)
    check((await page.$$(`${widget} [data-lr-generated]`)).length === 0, `${label}: broken source left output visible`)
    notes.push(`link-rewrite landing: ${status.trim()}`)
    notes.push(`link-rewrite edit: /users/:id → /members/:id; broken input: ${diagnostic.replace(/\s+/g, ' ').trim()}`)
  }
}
