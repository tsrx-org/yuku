// Proves the table carries every binding with its floor and the browser marks (or declines to mark) a row.
export default async function verify({ routes, open, check, notes }) {
  for (const route of routes) {
    const page = await open(route, `platforms-table:${route}`)
    const widget = '[data-widget="platforms-table"]'
    await page.locator(widget).first().scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })
    const rows = await page.$$eval(`${widget} [data-platform-row]`, (nodes) =>
      nodes.map((node) => {
        const cells = [...node.querySelectorAll('td')].map((cell) => cell.textContent.trim())
        return { name: cells[0], floor: cells[4], node: cells[6], match: node.dataset.platformMatch }
      }),
    )
    check(rows.length === 2, `${route}: expected the two binding rows, found ${rows.length}`)
    check(rows.every((row) => row.floor.startsWith('-Dcpu=')), `${route}: a row has no CPU floor: ${rows.map((row) => row.floor).join(' | ')}`)
    check(rows.every((row) => row.node === '>=22'), `${route}: a row's Node range is not >=22: ${rows.map((row) => row.node).join(' | ')}`)
    check(rows.every((row) => ['yes', 'no', 'unknown'].includes(row.match)), `${route}: a row was left unmarked`)
    const status = (await page.textContent(`${widget} [data-widget-status]`)).trim()
    check(status.startsWith('your browser'), `${route}: the status does not report what the browser said: ${status}`)
    const marked = rows.filter((row) => row.match === 'yes').map((row) => row.name)
    check(
      marked.length <= 1 && (marked.length === 0 || status.includes(marked[0])),
      `${route}: marked rows ${marked.join(', ') || 'none'} disagree with the status: ${status}`,
    )
    await page.locator(`${widget} [data-platform-row]`).first().focus()
    const rowReadout = (await page.textContent(`${widget} [data-widget-status]`)).trim()
    check(rowReadout.includes('supports'), `${route}: focusing a marked row did not describe it: ${rowReadout}`)
    notes.push(`platforms-table on ${route}: ${rows.map((row) => `${row.name} ${row.floor}`).join('; ')}; ${status}`)
  }
}
