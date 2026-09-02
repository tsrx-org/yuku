// Proves the visitor widget in a real browser: it lands with every
// JSXIfExpression lit, the select is filled from the parsed tree, and picking
// another type moves the highlight and the count.
export default async function verify({ routes, open, check, notes }) {
  const widget = '[data-widget="visitor"]'
  for (const route of routes) {
    const label = `visitor:${route}`
    const page = await open(route, label)
    await page.locator(widget).first().scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })

    const litText = () =>
      page.$$eval(`${widget} .ex-seg.ex-hit`, (nodes) => nodes.map((node) => node.textContent).join(''))
    const hitRows = () => page.$$eval(`${widget} [data-vi-hit]`, (nodes) => nodes.length)

    const landing = await page.inputValue(`${widget} [data-vi-type]`)
    check(landing === 'JSXIfExpression', `${label}: the select does not land on JSXIfExpression: ${landing}`)
    const source = await page.inputValue(`${widget} .ex-editor`)
    check(
      source.includes('export function Badge({ count, label }) @{') && !source.includes('return ('),
      `${label}: the seed is not a TSRX component body`,
    )
    const options = await page.$$eval(`${widget} [data-vi-type] option`, (nodes) => nodes.map((node) => node.value))
    check(options.length >= 10 && options.includes('JSXElement'), `${label}: the select holds ${options.length} types`)
    const ifHits = await hitRows()
    const ifLit = await litText()
    check(ifHits === 3 && ifLit.includes('@if'), `${label}: landing lit ${ifHits} @if node(s): ${JSON.stringify(ifLit.slice(0, 40))}`)
    let status = await page.textContent(`${widget} [data-widget-status]`)
    check(
      status.includes(`${ifHits} JSXIfExpression node`) && status.includes('runs in your browser'),
      `${label}: status does not count the lit nodes: ${status}`,
    )
    const code = await page.textContent(`${widget} [data-vi-out] code`)
    check(
      code.includes('JSXIfExpression(node)') && code.includes('hits.length === 3'),
      `${label}: the visitor code does not name and count the three matches`,
    )
    await page.locator(`${widget} [data-vi-hit]`).first().focus()
    const readout = await page.textContent(`${widget} [data-vi-readout]`)
    check(/JSXIfExpression spans \d+:\d+/.test(readout), `${label}: focusing a match did not show its span: ${readout}`)

    await page.selectOption(`${widget} [data-vi-type]`, 'JSXElement')
    await page.waitForFunction(
      (root) => /JSXElement node/.test(document.querySelector(`${root} [data-widget-status]`)?.textContent ?? ''),
      widget,
      { timeout: 10_000 },
    )
    const elementHits = await hitRows()
    const elementLit = await litText()
    check(elementHits === 4, `${label}: switching to JSXElement found ${elementHits} nodes instead of 4`)
    check(elementLit.includes('<span') && !elementLit.startsWith('@if'), `${label}: JSXElement did not light the elements`)
    status = await page.textContent(`${widget} [data-widget-status]`)
    notes.push(`visitor: ${ifHits} @if, ${elementHits} elements · ${status.trim()}`)
  }
}
