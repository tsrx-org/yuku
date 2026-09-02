export default async function verify({ routes, open, check, notes }) {
  const widget = '[data-widget="keyed-loops"]'
  for (const route of routes) {
    const page = await open(route, `keyed-loops:${route}`)
    await page.locator(widget).scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })
    const output = () => page.textContent(`${widget} [data-kl-generated]`)
    check((await output()).includes('row of rows; key row.id'), 'keyed-loops: row loop was not keyed')
    check((await output()).includes('card of cards; key card.id'), 'keyed-loops: existing key changed')
    const marked = (await page.$$eval(`${widget} .kl-change`, (nodes) => nodes.map((node) => node.textContent).join(''))).replace(/\s+/g, ' ')
    check(marked.includes('; key row.id') && marked.includes('; key user.id'), `keyed-loops: landing changes are not marked: ${marked}`)
    const editor = page.locator(`${widget} .ex-editor`)
    await editor.fill((await editor.inputValue()).replace('const user of users', 'const person of users'))
    await page.waitForFunction((selector) => document.querySelector(`${selector} [data-kl-generated]`)?.textContent.includes('key person.id'), widget)
    check((await output()).includes('key person.id'), 'keyed-loops: edit did not rerun the transform')
    await page.click(`${widget} [data-kl-reset]`)
    await page.waitForFunction((selector) => document.querySelector(`${selector} [data-kl-generated]`)?.textContent.includes('key user.id'), widget)
    check((await output()).includes('key user.id'), 'keyed-loops: Reset did not restore the landing output')
    notes.push('keyed-loops: 2 loops keyed; person edit re-keyed; Reset restored user')
  }
}
