// Proves the symbol-table widget does what its prompt says in a real browser:
// the landing state flags the unresolved reference, hovering a token reads its
// scope out of nodeScope, and a symbol row lights its declaration and uses.
export default async function verify({ routes, open, check, notes }) {
  const widget = '[data-widget="symbol-table"]'
  for (const route of routes) {
    const label = `symbol-table:${route}`
    const page = await open(route, label)
    await page.locator(widget).first().scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })

    const status = await page.textContent(`${widget} [data-widget-status]`)
    check(
      /1 name resolves to nothing: reset/.test(status) && status.includes('runs in your browser'),
      `${label}: status does not name the one unresolved reference: ${status}`,
    )

    const dotted = await page.$$eval(`${widget} .ex-seg.ex-unresolved`, (nodes) =>
      nodes.map((node) => node.textContent),
    )
    check(
      dotted.length === 1 && dotted[0] === 'reset',
      `${label}: expected exactly one dotted source token "reset", got ${JSON.stringify(dotted)}`,
    )

    const selected = await page.getAttribute(`${widget} [data-st-tab="reference"]`, 'aria-selected')
    check(selected === 'true', `${label}: the References tab is not selected on landing`)
    const flagged = await page.$$eval(`${widget} tr.st-row-unresolved`, (rows) =>
      rows.map((row) => row.textContent.replace(/\s+/g, ' ').trim()),
    )
    check(
      flagged.length === 1 && /reset/.test(flagged[0]) && /null/.test(flagged[0]),
      `${label}: the reference table does not flag reset -> null: ${JSON.stringify(flagged)}`,
    )

    // Hover `total` in the code block: it is declared inside the @{ } block.
    const totalSegment = page.locator(`${widget} .ex-seg`, { hasText: /^total$/ }).first()
    const totalBox = await totalSegment.boundingBox()
    check(Boolean(totalBox), `${label}: total has no hoverable source box`)
    if (totalBox) await page.mouse.move(totalBox.x + totalBox.width / 2, totalBox.y + totalBox.height / 2)
    await page.waitForFunction(
      (root) => /scope \d+/.test(document.querySelector(`${root} [data-st-readout]`)?.textContent ?? ''),
      widget,
      { timeout: 10_000 },
    )
    const readout = await page.textContent(`${widget} [data-st-readout]`)
    check(/block/.test(readout), `${label}: hovering total did not read a block scope: ${readout}`)
    const outlined = await page.$$eval(`${widget} .ex-seg.ex-scope`, (nodes) => nodes.length)
    check(outlined > 0, `${label}: hovering a token did not outline its scope in the source`)
    notes.push(`symbol-table hover: ${readout.trim()}`)

    await page.$eval(`${widget} .ex-editor`, (textarea) => {
      const offset = textarea.value.indexOf('reset')
      textarea.focus()
      textarea.setSelectionRange(offset, offset)
      textarea.dispatchEvent(new Event('select', { bubbles: true }))
    })
    const unresolvedReadout = await page.textContent(`${widget} [data-st-readout]`)
    check(/reset: no declaration in this file, symbolId is null/.test(unresolvedReadout), `${label}: focusing reset did not explain its null symbol: ${unresolvedReadout}`)

    await page.locator(`${widget} [data-st-tab="symbol"]`).focus()
    await page.locator(`${widget} [data-st-tab="symbol"]`).press('Enter')
    check((await page.getAttribute(`${widget} [data-st-tab="symbol"]`, 'aria-selected')) === 'true', `${label}: Symbols did not become the active tab`)
    const itemsRow = page.locator(`${widget} tr[data-st-row="symbol"]`, { hasText: /items/ }).first()
    await itemsRow.click()
    const decls = await page.$$eval(`${widget} .ex-seg.ex-decl`, (nodes) => nodes.length)
    const refs = await page.$$eval(`${widget} .ex-seg.ex-ref`, (nodes) => nodes.length)
    check(decls >= 1 && refs >= 2, `${label}: the items row lit ${decls} declaration(s) and ${refs} reference(s)`)

    await page.click(`${widget} [data-st-tab="import"]`)
    const importText = await page.textContent(`${widget} [data-st-out]`)
    check(/\.\/format/.test(importText), `${label}: the import table does not list ./format`)
    await page.click(`${widget} [data-st-tab="export"]`)
    const exportText = await page.textContent(`${widget} [data-st-out]`)
    check(/Cart/.test(exportText), `${label}: the export table does not list Cart`)
    notes.push(`symbol-table status: ${status.trim()}`)
  }
}
