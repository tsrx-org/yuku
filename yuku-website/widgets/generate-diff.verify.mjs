// Verifies the quick-start printer and full generate comparison.
export default async function verify({ routes, open, check, notes }) {
  const widget = '[data-widget="generate-diff"]'
  for (const route of routes) {
    const label = `generate-diff:${route}`
    const simple = route.includes('/guide/quick-start')
    const page = await open(route, label)
    await page.locator(widget).first().scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })

    const callOf = (id) => page.textContent(`${widget} [data-gd-call="${id}"]`)
    const outputOf = (id) => page.textContent(`${widget} [data-gd-generated="${id}"]`)
    const diffLines = (kind) =>
      page.$$eval(`${widget} [data-gd-line="${kind}"]`, (nodes) => nodes.map((node) => node.textContent))
    // The call text is what an option changes; the status can repeat verbatim
    // when two runs take the same fraction of a millisecond.
    const waitForCallChange = async (id, previous) =>
      page.waitForFunction(
        ([root, side, before]) =>
          (document.querySelector(`${root} [data-gd-call="${side}"]`)?.textContent ?? '') !== before,
        [widget, id, previous],
        { timeout: 15_000 },
      )

    if (simple) {
      const headings = await page.$$eval(`${widget} h3`, (nodes) => nodes.map((node) => node.textContent.trim()))
      const controls = await page.$$eval(`${widget} [data-gd-controls="b"] > *`, (nodes) =>
        nodes.map((node) => node.textContent.trim()),
      )
      check(JSON.stringify(headings) === JSON.stringify(['Source', 'Shipped module']), `${label}: simple headings are ${JSON.stringify(headings)}`)
      check(JSON.stringify(controls) === JSON.stringify(['Strip types']), `${label}: simple controls are ${JSON.stringify(controls)}`)
      check((await page.locator(`${widget} [data-gd-side="a"]`).count()) === 0, `${label}: simple mode still renders As written`)
      check((await page.locator(`${widget} [data-gd-diff]`).count()) === 0, `${label}: simple mode still renders a diff`)
      check((await page.locator(`${widget} [data-gd-call]`).count()) === 1, `${label}: simple mode does not have one call line`)
      check((await callOf('b')).trim() === 'generate(program, { strip: true })', `${label}: simple call is ${await callOf('b')}`)
      check(!(await outputOf('b')).includes('import type'), `${label}: simple landing output still has types`)
      let status = await page.textContent(`${widget} [data-widget-status]`)
      check(/types stripped · generated in [\d.]+ ms · runs in your browser/.test(status), `${label}: simple status is ${status}`)

      const editor = page.locator(`${widget} .ex-editor`)
      await editor.fill(`${await editor.inputValue()}\n`)
      await page.waitForSelector(`${widget} [data-gd-reset]:not([hidden])`, { timeout: 10_000 })
      await page.click(`${widget} [data-gd-reset]`)
      await page.waitForSelector(`${widget} [data-gd-reset][hidden]`, { state: 'attached', timeout: 10_000 })
      const callBefore = await callOf('b')
      await page.click(`${widget} [data-gd-flag="strip"]`)
      await waitForCallChange('b', callBefore)
      check((await callOf('b')).trim() === 'generate(program, {})', `${label}: strip-off call is ${await callOf('b')}`)
      check((await outputOf('b')).includes('import type') && (await outputOf('b')).includes(': Item'), `${label}: types did not return when Strip types was turned off`)
      status = await page.textContent(`${widget} [data-widget-status]`)
      notes.push(`generate-diff simple: ${status.trim()}`)
      continue
    }

    const callA = await callOf('a')
    const callB = await callOf('b')
    const headingA = await page.textContent(`${widget} [data-gd-side="a"] h3`)
    const aControls = await page.locator(`${widget} [data-gd-controls="a"]`).count()
    const quickItems = await page.$$eval(`${widget} [data-gd-controls="b"] > *`, (nodes) =>
      nodes.map((node) => node.textContent.trim()),
    )
    check(headingA === 'As written', `${label}: A is not labelled As written: ${headingA}`)
    check(aControls === 0, `${label}: A still has an options toolbar`)
    check(
      JSON.stringify(quickItems) === JSON.stringify(['Strip types', 'Minify', 'CommentsKeepDrop', 'QuotesAs writtenDoubleSingle']),
      `${label}: B does not have exactly the four quick controls: ${JSON.stringify(quickItems)}`,
    )
    check(/generate\(program, \{\}\)/.test(callA), `${label}: A does not land on the default call: ${callA}`)
    check(/strip: true/.test(callB), `${label}: B does not land on strip: true: ${callB}`)
    const removed = await diffLines('del')
    const added = await diffLines('add')
    const expectsFull = route.includes('/guide/generate')
    check(expectsFull, `${label}: a non-simple route is not the full generate guide`)
    const expectedDiff = { removed: 4, added: 1 }
    check(
      removed.length === expectedDiff.removed && added.length === expectedDiff.added,
      `${label}: landing diff is ${removed.length} removed/${added.length} added, expected ${expectedDiff.removed}/${expectedDiff.added}`,
    )
    check(
      removed.some((line) => line.includes('import type')),
      `${label}: the landing diff does not show strip removing the type import: ${JSON.stringify(removed)}`,
    )
    check(
      !(await outputOf('b')).includes('import type') && (await outputOf('a')).includes('import type'),
      `${label}: strip did not remove the type-only import from B`,
    )
    const source = await page.inputValue(`${widget} .ex-editor`)
    check(
      source.includes('/* The cart list, one row per item. */') || source.includes('// Keep this comment in the shipped module.'),
      `${label}: the source seed lost its comment`,
    )
    if (expectsFull) {
      check(
        source.includes('export function Cart({ items }: { items: Item[] }) @{') && !source.includes('return ('),
        `${label}: the full seed is not a typed TSRX component body`,
      )
      check(
        (await outputOf('a')).includes('}) @{') && (await outputOf('b')).includes('export function Cart({ items }) @{'),
        `${label}: generated outputs do not preserve the component body while strip removes its signature type`,
      )
    } else {
      check((await outputOf('b')).includes('// Keep this comment in the shipped module.'), `${label}: comments=all did not keep the source comment`)
    }
    notes.push(`generate-diff landing: ${removed.length} removed, ${added.length} added`)

    await page.locator(`${widget} [data-gd-line="del"]`).first().focus()
    const diffReadout = await page.textContent(`${widget} [data-gd-readout]`)
    check(diffReadout.includes('Removed from output B'), `${label}: focusing a changed line did not explain the diff: ${diffReadout}`)

    let status = await page.textContent(`${widget} [data-widget-status]`)
    check(status.includes('runs in your browser'), `${label}: status does not say where it ran: ${status}`)

    const aBefore = await outputOf('a')
    // Strip removes the type-only import, the only string in the seed; turn it off so a quote choice has something to requote.
    if ((await page.getAttribute(`${widget} [data-gd-controls="b"] [data-gd-flag="strip"]`, 'aria-checked')) === 'true') {
      const callBeforeStrip = await callOf('b')
      await page.click(`${widget} [data-gd-controls="b"] [data-gd-flag="strip"]`)
      await waitForCallChange('b', callBeforeStrip)
    }
    const callBeforeQuotes = await callOf('b')
    await page.click(`${widget} [data-gd-controls="b"] [data-gd-quick="quotes"][data-gd-value="single"]`)
    await waitForCallChange('b', callBeforeQuotes)
    check((await outputOf('b')).includes("'./item'"), `${label}: single quotes on B did not requote ./item`)
    check((await outputOf('a')) === aBefore, `${label}: a quote choice on B changed A`)
    check(/quotes: "single"/.test(await callOf('b')), `${label}: the B call does not name single quotes`)

    const beforeMinify = await callOf('b')
    const bBeforeMinify = await outputOf('b')
    await page.click(`${widget} [data-gd-controls="b"] [data-gd-flag="minify"]`)
    await waitForCallChange('b', beforeMinify)
    status = await page.textContent(`${widget} [data-widget-status]`)
    const bMinified = await outputOf('b')
    const minifyCall = await callOf('b')
    check(bMinified.length < bBeforeMinify.length && !bMinified.includes(' = '), `${label}: Minify did not shorten B`)
    check((await outputOf('a')) === aBefore, `${label}: Minify on B changed A`)
    check(
      /format: "compact"/.test(minifyCall) && /minify: \{ syntax: true \}/.test(minifyCall),
      `${label}: Minify did not set compact format and syntax minification together: ${minifyCall}`,
    )

    const more = page.locator(`${widget} .gd-more`)
    check((await more.count()) === (expectsFull ? 1 : 0), `${label}: More options presence does not match the marker`)
    if (expectsFull) {
      await more.locator('summary').click()
      const commentModes = await page.$$eval(`${widget} [data-gd-advanced] [data-gd-option="comments"]`, (nodes) =>
        nodes.map((node) => node.dataset.gdValue),
      )
      check(
        JSON.stringify(commentModes) === JSON.stringify(['none', 'all', 'some', 'line', 'block']),
        `${label}: More options does not carry every comments mode: ${JSON.stringify(commentModes)}`,
      )
      const indentDisabled = await page.getAttribute(`${widget} [data-gd-advanced] [data-gd-indent]`, 'disabled')
      check(indentDisabled !== null, `${label}: compact format left the advanced indent input enabled`)
      const shortest = await page.getAttribute(
        `${widget} [data-gd-advanced] [data-gd-option="quotes"][data-gd-value="shortest"]`,
        'disabled',
      )
      check(shortest !== null, `${label}: the advanced shortest-quotes choice is not disabled`)
    }

    const stripBefore = await page.getAttribute(`${widget} [data-gd-controls="b"] [data-gd-flag="strip"]`, 'aria-checked')
    await page.locator(`${widget} [data-gd-controls="b"] [data-gd-flag="strip"]`).focus()
    await page.locator(`${widget} [data-gd-controls="b"] [data-gd-flag="strip"]`).press('Enter')
    check((await page.getAttribute(`${widget} [data-gd-controls="b"] [data-gd-flag="strip"]`, 'aria-checked')) !== stripBefore, `${label}: Strip types switch did not toggle`)
    notes.push(`generate-diff status: ${status.trim()}`)
  }
}
