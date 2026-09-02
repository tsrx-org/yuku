// Proves the generate-diff widget in a real browser: the landing diff shows
// what strip removes, one chip on B changes only B and the diff follows, and
// shortest is refused rather than faked.
export default async function verify({ routes, open, check, notes }) {
  const widget = '[data-widget="generate-diff"]'
  for (const route of routes) {
    const label = `generate-diff:${route}`
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

    const callA = await callOf('a')
    const callB = await callOf('b')
    check(/generate\(program, \{\}\)/.test(callA), `${label}: A does not land on the default call: ${callA}`)
    check(/strip: true/.test(callB), `${label}: B does not land on strip: true: ${callB}`)
    const removed = await diffLines('del')
    const added = await diffLines('add')
    check(
      removed.some((line) => line.includes('import type')),
      `${label}: the landing diff does not show strip removing the type import: ${JSON.stringify(removed)}`,
    )
    check(
      !(await outputOf('b')).includes('import type') && (await outputOf('a')).includes('import type'),
      `${label}: strip did not remove the type-only import from B`,
    )
    notes.push(`generate-diff landing: ${removed.length} removed, ${added.length} added`)

    await page.locator(`${widget} [data-gd-line="del"]`).first().focus()
    const diffReadout = await page.textContent(`${widget} [data-gd-readout]`)
    check(diffReadout.includes('Removed from output B'), `${label}: focusing a changed line did not explain the diff: ${diffReadout}`)

    let status = await page.textContent(`${widget} [data-widget-status]`)
    check(status.includes('runs in your browser'), `${label}: status does not say where it ran: ${status}`)

    const aBefore = await outputOf('a')
    await page.click(`${widget} [data-gd-controls="b"] [data-gd-option="format"][data-gd-value="compact"]`)
    await waitForCallChange('b', callB)
    status = await page.textContent(`${widget} [data-widget-status]`)
    const bCompact = await outputOf('b')
    check(bCompact.length < aBefore.length && !bCompact.includes(' = '), `${label}: compact on B did not shorten B`)
    check((await outputOf('a')) === aBefore, `${label}: a chip on B changed A`)
    check(/format: "compact"/.test(await callOf('b')), `${label}: the B call does not name compact`)
    const indentDisabled = await page.getAttribute(`${widget} [data-gd-controls="b"] [data-gd-indent]`, 'disabled')
    check(indentDisabled !== null, `${label}: compact left the indent input enabled on B`)

    await page.click(`${widget} [data-gd-controls="a"] [data-gd-option="quotes"][data-gd-value="single"]`)
    await waitForCallChange('a', callA)
    status = await page.textContent(`${widget} [data-widget-status]`)
    check((await outputOf('a')).includes("'./item'"), `${label}: single quotes on A did not requote ./item`)
    check(/quotes: "single"/.test(await callOf('a')), `${label}: the A call does not name single quotes`)

    const shortest = await page.getAttribute(
      `${widget} [data-gd-controls="a"] [data-gd-option="quotes"][data-gd-value="shortest"]`,
      'disabled',
    )
    check(shortest !== null, `${label}: the shortest chip is not disabled`)
    await page.locator(`${widget} [data-gd-controls="b"] [data-gd-flag="strip"]`).focus()
    await page.locator(`${widget} [data-gd-controls="b"] [data-gd-flag="strip"]`).press('Enter')
    check((await page.getAttribute(`${widget} [data-gd-controls="b"] [data-gd-flag="strip"]`, 'aria-checked')) === 'false', `${label}: Strip types switch did not toggle`)
    notes.push(`generate-diff status: ${status.trim()}`)
  }
}
