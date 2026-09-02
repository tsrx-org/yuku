// Proves the sweep is plotted on arrival and a slider size adds a point.
export default async function verify({ routes, open, check, notes }) {
  for (const route of routes) {
    const page = await open(route, `size-scaling:${route}`)
    const widget = '[data-widget="size-scaling"]'
    await page.locator(widget).first().scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 90_000 })
    const pointsOf = () =>
      page.$$eval(`${widget} circle.ss-point`, (nodes) =>
        nodes.map((node) => ({ kb: Number(node.dataset.ssKb), title: node.querySelector('title')?.textContent ?? '' })),
      )
    const sweep = await pointsOf()
    check(sweep.length >= 2, `${route}: the sweep plotted ${sweep.length} points`)
    check(
      sweep.every((point) => /\d+ KB: [\d.]+ ms/.test(point.title)),
      `${route}: a point has no size and time: ${sweep.map((point) => point.title).join(' | ')}`,
    )
    const statusBefore = (await page.textContent(`${widget} [data-widget-status]`)).trim()
    check(statusBefore.includes('ms-per-KB'), `${route}: the status does not report a slope: ${statusBefore}`)
    await page.locator(`${widget} circle.ss-point`).first().focus()
    const readout = await page.textContent(`${widget} [data-ss-readout]`)
    check(/KB parsed in [\d.]+ ms/.test(readout), `${route}: focusing a chart point did not read it: ${readout}`)

    await page.$eval(`${widget} [data-ss-size]`, (input) => {
      input.value = '96'
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const label = (await page.textContent(`${widget} [data-ss-size-label]`)).trim()
    check(label === '96 KB', `${route}: the slider label reads ${label}`)
    await page.click(`${widget} [data-ss-run]`)
    await page.waitForFunction(
      ([root, before]) => document.querySelectorAll(`${root} circle.ss-point`).length > before,
      [widget, sweep.length],
      { timeout: 60_000 },
    )
    const after = await pointsOf()
    const added = after.at(-1)
    check(added.kb >= 88 && added.kb <= 104, `${route}: the added point is ${added.kb} KB, expected about 96`)
    const userPoints = await page.$$eval(`${widget} circle.ss-point-user`, (nodes) => nodes.length)
    check(userPoints === 1, `${route}: expected one reader-added point, found ${userPoints}`)
    const statusAfter = (await page.textContent(`${widget} [data-widget-status]`)).trim()
    check(statusAfter.includes('your browser'), `${route}: the status does not say where it ran: ${statusAfter}`)
    notes.push(`size-scaling on ${route}: ${sweep.map((point) => point.title).join('; ')}; ${statusAfter}`)
  }
}
