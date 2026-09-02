export default async function verify({ routes, open, check, notes }) {
  const widget = '[data-widget="what-rerenders"]'
  for (const route of routes) {
    const page = await open(route, `what-rerenders:${route}`)
    await page.locator(widget).scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })
    const landing = (await page.textContent(`${widget} [data-wr-readout]`)).trim()
    check(landing === 'items feeds 4 places: total, label, the @for, item.title', `what-rerenders: landing readout is ${landing}`)
    check((await page.getAttribute(widget, 'data-selected')) === 'items', 'what-rerenders: items is not selected on landing')
    check((await page.getAttribute(widget, 'data-places')) === '4', 'what-rerenders: landing does not resolve four places')
    check((await page.locator(`${widget} .ex-source span[style*="--shiki-light"]`).count()) > 0, 'what-rerenders: source has no grammar highlighting')
    const editor = page.locator(`${widget} .ex-editor`)
    await editor.evaluate((textarea) => {
      const at = textarea.value.indexOf('user')
      textarea.focus()
      textarea.setSelectionRange(at, at)
      textarea.dispatchEvent(new Event('select', { bubbles: true }))
    })
    await page.waitForFunction((selector) => document.querySelector(selector)?.dataset.selected === 'user', widget)
    const changed = (await page.textContent(`${widget} [data-wr-readout]`)).trim()
    check(changed === 'user feeds 1 place: name', `what-rerenders: user readout is ${changed}`)
    check((await page.getAttribute(widget, 'data-places')) === '1', 'what-rerenders: user does not resolve one place')
    notes.push(`what-rerenders: ${landing}; ${changed}`)
  }
}
