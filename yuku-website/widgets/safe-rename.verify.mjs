export default async function verify({ routes, open, check, notes }) {
  const widget = '[data-widget="safe-rename"]'
  for (const route of routes) {
    const page = await open(route, `safe-rename:${route}`)
    await page.locator(widget).scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })
    const output = () => page.textContent(`${widget} [data-sr-generated]`)
    check((await page.locator(`${widget} .sr-change`).count()) === 4, 'safe-rename: landing does not mark 4 renamed places')
    check((await output()).includes('(count) => count + 1'), 'safe-rename: shadow changed on landing')
    const editor = page.locator(`${widget} .ex-editor`)
    await editor.fill((await editor.inputValue()).replace('count * 2', 'count * 3'))
    await page.waitForFunction((selector) => document.querySelector(`${selector} [data-sr-generated]`)?.textContent.includes('total * 3'), widget)
    check((await output()).includes('total * 3'), 'safe-rename: source edit did not rerun analysis')
    const input = page.locator(`${widget} [data-sr-name]`)
    await input.fill('amount')
    await page.waitForFunction((selector) => document.querySelector(`${selector} [data-sr-generated]`)?.textContent.includes('let amount'), widget)
    check((await output()).includes('(count) => count + 1'), 'safe-rename: rename control changed the shadow')
    notes.push('safe-rename: 4 outer places renamed; source edit followed; amount left the inner count alone')
  }
}
