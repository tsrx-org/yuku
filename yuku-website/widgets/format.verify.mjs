export default async function verify({ routes, open, check, notes }) {
  const widget = '[data-widget="format"]'
  for (const route of routes) {
    const page = await open(route, `format:${route}`)
    await page.locator(widget).scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })
    const output = () => page.textContent(`${widget} [data-fm-generated]`)
    check((await output()).includes('const label = "Ready";'), 'format: landing output is not pretty or double quoted')
    const editor = page.locator(`${widget} .ex-editor`)
    await editor.fill((await editor.inputValue()).replace("'Ready'", "'Shipped'"))
    await page.waitForFunction((selector) => document.querySelector(`${selector} [data-fm-generated]`)?.textContent.includes('"Shipped"'), widget)
    check((await output()).includes('"Shipped"'), 'format: edit was not regenerated')
    await page.click(`${widget} [data-fm-minify]`)
    await page.waitForFunction((selector) => document.querySelector(`${selector} [data-fm-call]`)?.textContent.includes('minify: true'), widget)
    const readout = await page.textContent(`${widget} [data-fm-readout]`)
    check(/\d+ bytes → \d+ bytes/.test(readout), `format: minify readout is ${readout}`)
    check(!(await output()).includes(' = '), 'format: Minify did not compact the output')
    notes.push(`format: pretty landing; Shipped edit; Minify ${readout.trim()}`)
  }
}
