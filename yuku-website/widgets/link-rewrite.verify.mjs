export default async function verify({ routes, open, check, notes }) {
  const widget = '[data-widget="link-rewrite"]'
  for (const route of routes) {
    const label = `link-rewrite:${route}`
    const page = await open(route, label)
    await page.locator(widget).scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })

    const status = await page.textContent(`${widget} [data-widget-status]`)
    const landing = await page.textContent(`${widget} [data-lr-generated]`)
    const readout = await page.textContent(`${widget} [data-lr-readout]`)
    check(/1 link rewritten, 1 left for the runtime/.test(status), `${label}: unexpected landing status: ${status}`)
    check(landing.includes('<Link href="/users/42">Profile</Link>'), `${label}: literal id was not substituted: ${landing}`)
    check(!landing.includes('href="/users/42" params='), `${label}: rewritten tag kept its params attribute`)
    check(landing.includes('<Link href="/posts/:slug" params={{ slug: post.slug }}>'), `${label}: variable link changed`)
    check(readout.includes('left for the runtime: /posts/:slug needs post.slug'), `${label}: runtime link is missing from the readout: ${readout}`)
    check(landing.includes('<Link href="/pricing">'), `${label}: static Link changed`)
    check(landing.includes('<a href="/about">'), `${label}: plain anchor changed`)
    check((await page.locator(`${widget} .lr-change`).count()) === 2, `${label}: substituted href and removed params are not both marked`)

    const editor = page.locator(`${widget} textarea[aria-label="Editable TSRX link source"]`)
    await editor.fill((await editor.inputValue()).replace('"42"', '"7"'))
    await page.waitForFunction(
      (selector) => document.querySelector(`${selector} [data-lr-generated]`)?.textContent.includes('href="/users/7"'),
      widget,
      { timeout: 15_000 },
    )
    const afterLiteralEdit = await page.textContent(`${widget} [data-lr-generated]`)
    check(afterLiteralEdit.includes('<Link href="/users/7">Profile</Link>'), `${label}: editing the literal did not produce /users/7`)

    await page.click(`${widget} [data-lr-reset]`)
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.value.includes('"42"'),
      `${widget} textarea[aria-label="Editable TSRX link source"]`,
      { timeout: 15_000 },
    )
    await editor.fill((await editor.inputValue()).replace('"42"', 'user.id'))
    await page.waitForFunction(
      (selector) => document.querySelector(selector)?.dataset.runtime === '2',
      widget,
      { timeout: 15_000 },
    )
    const variableStatus = await page.textContent(`${widget} [data-widget-status]`)
    const variableOutput = await page.textContent(`${widget} [data-lr-generated]`)
    const variableReadout = await page.textContent(`${widget} [data-lr-readout]`)
    check(/0 links rewritten, 2 left for the runtime/.test(variableStatus), `${label}: variable edit did not update status: ${variableStatus}`)
    check(variableOutput.includes('href="/users/:id" params={{ id: user.id }}'), `${label}: variable edit changed the user tag`)
    check(variableReadout.includes('left for the runtime: /users/:id needs user.id'), `${label}: variable edit is missing from the readout: ${variableReadout}`)

    await editor.fill('const nav = <nav>')
    await page.waitForSelector(`${widget}[data-widget-state="error"] [data-lr-diagnostics]`, { timeout: 15_000 })
    const diagnostic = await page.textContent(`${widget} [data-lr-diagnostics]`)
    check(diagnostic.trim().length > 0, `${label}: broken source showed no diagnostic`)
    check((await page.$$(`${widget} [data-lr-generated]`)).length === 0, `${label}: broken source left output visible`)
    notes.push(`link-rewrite landing: ${status.trim()}`)
    notes.push(`link-rewrite edits: /users/42 → /users/7 → runtime; broken input: ${diagnostic.replace(/\s+/g, ' ').trim()}`)
  }
}
