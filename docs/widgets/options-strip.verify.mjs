// The strip's promise: flipping a chip re-parses, and "break it" shows the
// underline and the help line. Each step reads what the engine printed.
export default async function verify({ routes, open, check, notes }) {
  for (const route of routes) {
    const page = await open(route, `options-strip:${route}`)
    const widget = '[data-widget="options-strip"]'
    await page.locator(widget).first().scrollIntoViewIfNeeded()
    await page.waitForSelector(`${widget}[data-widget-state="ready"]`, { timeout: 30_000 })
    const outText = () => page.textContent(`${widget} [data-os-out]`)
    const callText = () => page.textContent(`${widget} [data-os-call]`)
    const statusOf = () => page.textContent(`${widget} [data-widget-status]`)
    const waitOut = (predicate, label) =>
      page
        .waitForFunction(
          ([root, source]) =>
            new Function('text', `return ${source}`)(document.querySelector(`${root} [data-os-out]`)?.textContent ?? ''),
          [widget, predicate],
          { timeout: 15_000 },
        )
        .catch(() => check(false, `${route}: ${label}`))

    const rest = await outText()
    check(/diagnostics0/.test(rest.replace(/\s+/g, '')), `${route}: the seed did not parse clean at rest: ${rest.slice(0, 120)}`)
    check((await callText()).startsWith('parse(') && !(await callText()).includes('parseModule'), `${route}: the call line does not name parse`)
    check((await statusOf()).includes('runs in your browser'), `${route}: the status does not say where it ran`)

    await page.click(`${widget} [data-os-lang="js"]`)
    await waitOut('text.includes("Unexpected token")', 'lang js did not make the tsx seed fail on its markup')
    check((await callText()).includes('lang: "js"'), `${route}: the call line did not follow the lang chip`)
    const underlinedUnderJs = await page.locator(`${widget} [data-os-source] .wd-diag`).count()
    check(underlinedUnderJs > 0, `${route}: lang js produced diagnostics but no underline in the source`)
    await page.locator(`${widget} [data-os-source] [data-readout]`).first().focus()
    const readout = await page.textContent(`${widget} [data-os-readout]`)
    const messages = await page.$$eval(`${widget} .wd-diagnostics li`, (items) => items.map((item) => item.textContent.trim()))
    check(
      messages.some((message) => message.includes(readout.trim().replace(/\s+/g, ' ').slice(0, 40))) || /Unexpected token|Expected/.test(readout),
      `${route}: focusing the underline did not reveal its message: ${readout}`,
    )

    await page.click(`${widget} [data-os-lang="tsx"]`)
    await waitOut('!text.includes("Unexpected token")', 'switching back to tsx did not clear the diagnostics')

    await page.locator(`${widget} [data-os-flag="semanticErrors"]`).focus()
    await page.locator(`${widget} [data-os-flag="semanticErrors"]`).press('Space')
    check((await page.getAttribute(`${widget} [data-os-flag="semanticErrors"]`, 'aria-checked')) === 'true', `${route}: Check names switch did not turn on`)
    await waitOut('text.includes("warning")', 'semanticErrors did not surface the redeclaration warning')
    check((await callText()).includes('semanticErrors: true'), `${route}: the call line did not follow the semanticErrors chip`)
    const warningUnderline = await page.locator(`${widget} [data-os-source] .wd-warning`).count()
    check(warningUnderline > 0, `${route}: the warning has no underline in the source`)
    await page.click(`${widget} [data-os-flag="semanticErrors"]`)
    await waitOut('!text.includes("warning")', 'turning semanticErrors off did not remove the warning')

    await page.click(`${widget} [data-os-flag="attachComments"]`)
    await waitOut('text.includes("carrying them")', 'attachComments did not report attached comments')
    await page.click(`${widget} [data-os-flag="attachComments"]`)

    await page.click(`${widget} [data-os-break]`)
    await waitOut('text.includes("help:")', 'break it did not show a help line')
    const helpText = await page.textContent(`${widget} .wd-help`)
    check(helpText.includes('braces'), `${route}: the help line is not the braces hint: ${helpText}`)
    const errorUnderline = await page.locator(`${widget} [data-os-source] .wd-error`).count()
    check(errorUnderline > 0, `${route}: the broken snippet has no error underline`)
    check((await page.textContent(`${widget} [data-os-break]`)).trim() === 'Restore working example', `${route}: the broken-example action did not offer to restore it`)
    await page.click(`${widget} [data-os-break]`)
    await waitOut('!text.includes("help:")', 'fix it did not restore the clean seed')

    notes.push(`options-strip on ${route}: ${(await statusOf()).trim()}`)
  }
}
