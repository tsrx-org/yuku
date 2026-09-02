#!/usr/bin/env node
// Proves the interactive surfaces in a real browser, because "the wasm parses
// in Node" says nothing about whether the page can load it, and a tab that
// renders nothing looks exactly like a tab that renders something until you
// open one.
//
//   node docs/verify-playground.mjs                serves docs/dist locally
//   node docs/verify-playground.mjs --url <origin> runs against a deployment
//
// Pages are found by what the build emitted into docs/dist, not by a list here:
// a figure that no page carries is reported as skipped, and the home page, the
// playground is the one that must exist.
// It fails on any console error or uncaught page error, so a silently broken
// import cannot pass.
//
// The browser is PLAYWRIGHT_CHROME, else playwright's cached Chromium, else
// the macOS Chrome, else google-chrome/chromium on PATH.

import { spawn } from 'node:child_process'
import { access, readFile, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'
import config from './site.config.mjs'

const docsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(docsDir, '..')
const basePath = `/${config.base.split('/').filter(Boolean).join('/')}`.replace(/\/$/, '')
const distDir = path.join(docsDir, 'dist')
const siteDir = path.join(distDir, ...basePath.split('/').filter(Boolean))
const playgroundRoute = config.playground ?? '/playground'
const HOME_FIRST_LOAD_BUDGET_BYTES = 220_000

const urlFlag = process.argv.indexOf('--url')
const externalOrigin = urlFlag === -1 ? null : process.argv[urlFlag + 1]
if (urlFlag !== -1 && !externalOrigin) throw new Error('--url needs an origin')

const failures = []
const notes = []
const skipped = []
const check = (condition, message) => {
  if (!condition) failures.push(message)
  return condition
}

// ---------- browser ----------

const executable = (file) =>
  access(file, constants.X_OK)
    .then(() => true)
    .catch(() => false)

const CHROMIUM_LAYOUTS = [
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
  'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
  'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  'chrome-linux64/chrome',
  'chrome-linux/chrome',
  'chrome-headless-shell-mac-arm64/chrome-headless-shell',
  'chrome-headless-shell-mac/chrome-headless-shell',
  'chrome-headless-shell-linux64/chrome-headless-shell',
  'chrome-linux/headless_shell',
]

async function playwrightCacheCandidates() {
  const caches = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean)
  const found = []
  for (const cache of caches) {
    const entries = await readdir(cache).catch(() => [])
    // Newest build first, and a full Chromium before the headless shell.
    const builds = entries
      .map((name) => /^(chromium|chromium_headless_shell)-(\d+)$/.exec(name))
      .filter(Boolean)
      .sort((a, b) => (a[1] === b[1] ? Number(b[2]) - Number(a[2]) : a[1] === 'chromium' ? -1 : 1))
    for (const [name] of builds) {
      for (const layout of CHROMIUM_LAYOUTS) {
        const file = path.join(cache, name, layout)
        if (await executable(file)) found.push({ file, why: path.join(cache, name) })
      }
    }
  }
  return found
}

async function resolveBrowser() {
  const candidates = []
  if (process.env.PLAYWRIGHT_CHROME) {
    candidates.push({ file: process.env.PLAYWRIGHT_CHROME, why: 'PLAYWRIGHT_CHROME' })
  }
  try {
    candidates.push({ file: chromium.executablePath(), why: 'playwright-core executablePath()' })
  } catch {}
  candidates.push(...(await playwrightCacheCandidates()))
  candidates.push({
    file: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    why: 'macOS Google Chrome',
  })
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    for (const dir of (process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
      candidates.push({ file: path.join(dir, name), why: `${name} on PATH` })
    }
  }
  for (const candidate of candidates) {
    if (await executable(candidate.file)) return candidate
  }
  const listed = [...new Map(candidates.map((c) => [c.file, c])).values()]
    .filter((c) => !c.why.endsWith('on PATH'))
    .map((c) => `  - ${c.file} (${c.why})`)
  throw new Error(
    `no Chromium executable found. Tried:\n${listed.join('\n')}\n  - google-chrome, google-chrome-stable, chromium, chromium-browser on PATH\n` +
      'Set PLAYWRIGHT_CHROME to a browser binary, or run: pnpm exec playwright-core install chromium',
  )
}

// ---------- the built site ----------

async function htmlFiles(dir) {
  const out = []
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await htmlFiles(file)))
    else if (entry.name.endsWith('.html')) out.push(file)
  }
  return out.sort()
}

let builtPages = null
async function pagesWith(needle) {
  builtPages ??= await Promise.all(
    (await htmlFiles(siteDir)).map(async (file) => ({
      route: `/${path.relative(siteDir, file).replace(/\.html$/, '')}`.replace(/^\/index$/, '/'),
      html: await readFile(file, 'utf8'),
    })),
  )
  return builtPages.filter((page) => page.html.includes(needle)).map((page) => page.route)
}

// The first page carrying a marker, or null after noting the skip: a page under
// rewrite may not carry the figure yet, and that is not a broken site.
async function pageCarrying(needle, label) {
  const routes = await pagesWith(needle)
  if (routes.length === 0) {
    skipped.push(`${label}: no built page carries ${needle}`)
    return null
  }
  return routes[0]
}

async function startServer() {
  const child = spawn(process.execPath, [path.join(docsDir, 'serve.mjs'), '0'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: repoRoot,
  })
  let stderr = ''
  child.stderr.on('data', (chunk) => {
    stderr += chunk
  })
  const origin = await new Promise((resolve, reject) => {
    let buffer = ''
    const timer = setTimeout(
      () => reject(new Error(`docs/serve.mjs did not start: ${stderr || buffer}`)),
      15_000,
    )
    child.stdout.on('data', (chunk) => {
      buffer += chunk
      const match = /http:\/\/127\.0\.0\.1:(\d+)/.exec(buffer)
      if (match) {
        clearTimeout(timer)
        resolve(`http://127.0.0.1:${match[1]}`)
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`docs/serve.mjs exited with ${code}: ${stderr}`))
    })
  })
  return { origin, stop: () => child.kill() }
}

// Every page in the run shares one console-error sink: a stray error on the
// third page is as disqualifying as one on the first.
function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`${label}: console error: ${message.text()}`)
  })
  page.on('pageerror', (error) => {
    failures.push(`${label}: page error: ${error.message}`)
  })
  page.on('requestfailed', (request) => {
    failures.push(`${label}: request failed: ${request.url()} (${request.failure()?.errorText})`)
  })
}

const statusText = (page) =>
  page.evaluate(() => document.getElementById('demo-status')?.textContent ?? '')

const waitForParse = (page) =>
  page.waitForFunction(
    () => {
      const text = document.getElementById('demo-status')?.textContent ?? ''
      return !text.includes('loading') && / ms · /.test(text)
    },
    null,
    { timeout: 30_000 },
  )

const TABS = [
  ['ast', 'pg-ast'],
  ['diagnostics', 'pg-diagnostics'],
  ['generated', 'pg-generated'],
  ['semantic', 'pg-semantic'],
]

async function openTabs(page, label) {
  const seen = {}
  for (const [tab, target] of TABS) {
    await page.click(`#pg-tab-${tab}`)
    try {
      await page.waitForFunction(
        (id) => (document.getElementById(id)?.textContent ?? '').trim().length > 0,
        target,
        { timeout: 15_000 },
      )
    } catch {
      failures.push(`${label}: the ${tab} panel stayed empty`)
    }
    const selected = await page.getAttribute(`#pg-tab-${tab}`, 'aria-selected')
    check(selected === 'true', `${label}: ${tab} tab did not become the selected tab`)
    const hidden = await page.getAttribute(`#pg-panel-${tab}`, 'hidden')
    check(hidden === null, `${label}: ${tab} panel stayed hidden after its tab was clicked`)
    seen[tab] = await page.textContent(`#${target}`)
  }
  return seen
}

async function main() {
  const browserChoice = await resolveBrowser()
  notes.push(`browser: ${browserChoice.file} (${browserChoice.why})`)
  const server = externalOrigin ? null : await startServer()
  const origin = externalOrigin ?? server.origin
  const browser = await chromium.launch({ executablePath: browserChoice.file, headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } })
    const open = async (route, label) => {
      const page = await context.newPage()
      watch(page, label ?? route)
      await page.goto(`${origin}${basePath}${route === '/' ? '/' : route}`, { waitUntil: 'load' })
      return page
    }

    // ---- home page: the hero panel is a live editor with the four tabs ----
    const home = await context.newPage()
    watch(home, 'home')
    const firstLoadResponses = []
    let firstLoadWindowOpen = true
    home.once('load', () => {
      firstLoadWindowOpen = false
    })
    const wasmResponses = []
    home.on('response', (response) => {
      if (firstLoadWindowOpen) firstLoadResponses.push(response)
      if (response.url().endsWith('.wasm')) {
        wasmResponses.push({
          status: response.status(),
          type: response.headers()['content-type'] ?? '',
        })
      }
    })
    await home.goto(`${origin}${basePath}/`, { waitUntil: 'load' })
    const firstLoadTransferBytes = (
      await Promise.all(
        firstLoadResponses.map(async (response) => {
          await response.finished()
          const sizes = await response.request().sizes()
          return sizes.responseHeadersSize + sizes.responseBodySize
        }),
      )
    ).reduce((total, size) => total + size, 0)
    check(
      firstLoadTransferBytes <= HOME_FIRST_LOAD_BUDGET_BYTES,
      `home: first load transferred ${firstLoadTransferBytes.toLocaleString()} bytes, past the ${HOME_FIRST_LOAD_BUDGET_BYTES.toLocaleString()}-byte budget`,
    )
    notes.push(`home first load: ${firstLoadTransferBytes.toLocaleString()} bytes transferred`)
    check(
      !firstLoadResponses.some((response) => response.url().includes('/assets/demo-highlighter.js')),
      'home: demo-highlighter.js loaded inside the first-load window',
    )
    await waitForParse(home)
    const homeStatus = await statusText(home)
    check(homeStatus.includes('nodes'), `home: status has no node count: ${homeStatus}`)
    check(
      homeStatus.includes('runs in your browser'),
      `home: status does not say where it ran: ${homeStatus}`,
    )
    notes.push(`home status: ${homeStatus}`)
    check(wasmResponses.length > 0, 'home: the page never requested the wasm module')
    for (const response of wasmResponses) {
      check(response.status === 200, `home: wasm responded ${response.status}`)
      check(
        response.type.includes('application/wasm'),
        `home: wasm served as ${response.type || 'no content-type'}`,
      )
    }

    const homeTabs = await openTabs(home, 'home')
    check(
      homeTabs.ast.includes('JSXCodeBlock'),
      'home: the AST tab does not mention JSXCodeBlock, so it is not the TSRX AST',
    )
    check(
      homeTabs.diagnostics.includes('0 diagnostics'),
      `home: the hero snippet reported diagnostics: ${homeTabs.diagnostics.slice(0, 120)}`,
    )
    check(homeTabs.generated.includes('Cart'), 'home: the generated code tab does not mention Cart')
    check(
      /\d+ symbols/.test(homeTabs.semantic),
      `home: the semantic tab has no symbol count: ${homeTabs.semantic.slice(0, 120)}`,
    )

    // Typing has to move the status line: that is the whole claim of the panel.
    await home.click('#demo-input')
    await home.keyboard.press('Meta+ArrowDown')
    await home.keyboard.type('\nconst verified = 1;')
    await home.waitForFunction(
      (previous) => {
        const text = document.getElementById('demo-status')?.textContent ?? ''
        return text !== previous && / ms · /.test(text)
      },
      homeStatus,
      { timeout: 15_000 },
    )
    const editedStatus = await statusText(home)
    check(editedStatus.includes('nodes'), `home: edited status has no node count: ${editedStatus}`)
    notes.push(`home status after typing: ${editedStatus}`)

    // ---- the four home benchmark cards ----
    const cards = await home.$$eval('.gate-card', (nodes) =>
      nodes.map((node) => node.textContent.replace(/\s+/g, ' ').trim()),
    )
    check(cards.length === 4, `home: ${cards.length} benchmark cards, expected 4`)
    check(
      /\d\.\d\d[x×]/.test(cards[0] ?? ''),
      `home: the first card carries no two-decimal multiple: ${cards[0]}`,
    )
    notes.push(`home cards: ${cards.join(' | ')}`)

    // ---- a fixture click made while the playground module is still in flight ----
    const preReady = await context.newPage()
    watch(preReady, 'playground pre-ready')
    let releasePlayground
    const playgroundReleased = new Promise((resolve) => {
      releasePlayground = resolve
    })
    await preReady.route('**/yuku-playground.js', async (route) => {
      await playgroundReleased
      await route.continue()
    })
    await preReady.goto(`${origin}${basePath}${playgroundRoute}`, { waitUntil: 'load' })
    const fixtureButtons = preReady.locator('[data-scenario]')
    const fixtureButtonCount = await fixtureButtons.count()
    const fixturesVisible = await fixtureButtons.evaluateAll((buttons) =>
      buttons.every((button) => button.offsetParent !== null),
    )
    check(
      fixtureButtonCount > 0 && fixturesVisible,
      'playground pre-ready: the fixture buttons are not visible',
    )
    const fixtureButton = preReady.locator('#pg-scenario-control-flow-switch-invalid')
    const startingStatus = await statusText(preReady)
    check(
      startingStatus === 'a TSRX component, highlighted with the TSRX grammar',
      `playground pre-ready: the status bar left its starting state: ${startingStatus}`,
    )
    const expectedFixture = await preReady.evaluate(() =>
      JSON.parse(document.getElementById('pg-fixtures').textContent)['control-flow-switch-invalid'].source,
    )
    await preReady.evaluate(() => {
      globalThis.__fixtureClicks = 0
      document.getElementById('pg-scenario-control-flow-switch-invalid').addEventListener('click', () => {
        globalThis.__fixtureClicks++
      })
    })
    const playgroundRequested = preReady.waitForRequest('**/yuku-playground.js')
    await fixtureButton.click()
    await playgroundRequested
    releasePlayground()
    await waitForParse(preReady)
    const replayedFixture = await preReady.inputValue('#demo-input')
    const fixtureClicks = await preReady.evaluate(() => globalThis.__fixtureClicks)
    check(
      replayedFixture === expectedFixture && fixtureClicks === 2,
      `playground pre-ready: expected one replay with the fixture source, saw ${fixtureClicks - 1}`,
    )
    notes.push('playground pre-ready: fixture click replayed after the module became ready')

    // ---- the playground: fixtures, and real diagnostics on the invalid one ----
    const playground = await open(playgroundRoute, 'playground')
    await waitForParse(playground)
    await playground.locator('#demo-input').press('End')
    await playground.locator('#demo-input').type('\nconst highlighted = true')
    await playground.waitForFunction(
      () =>
        document.querySelector('#demo-editor pre')?.textContent ===
          document.querySelector('#demo-input')?.value &&
        Boolean(document.querySelector('#demo-editor pre code span[style*="--shiki-light"]')),
      null,
      { timeout: 15_000 },
    )
    check(
      (await playground.locator('#demo-editor pre code span[style*="--shiki-light"]').count()) > 0,
      'playground: typing left the visible code layer without real Shiki token spans',
    )
    notes.push(`playground status: ${await statusText(playground)}`)
    await openTabs(playground, 'playground')

    await playground.click('#pg-scenario-control-flow-switch-invalid')
    await playground.click('#pg-tab-diagnostics')
    try {
      await playground.waitForFunction(
        () => (document.getElementById('pg-diagnostics')?.textContent ?? '').includes('error'),
        null,
        { timeout: 15_000 },
      )
    } catch {
      failures.push('playground: the invalid switch fixture produced no error diagnostic')
    }
    const invalidStatus = await statusText(playground)
    notes.push(`invalid fixture status: ${invalidStatus}`)
    const fixtureSource = await playground.inputValue('#demo-input')
    check(
      fixtureSource.includes('@switch'),
      'playground: the fixture button did not load the committed fixture text',
    )

    // ---- a doc fence, handed to the playground by its own button ----
    const tryRoute = (await pagesWith('class="try-button"')).find(
      (route) => route !== '/' && route !== playgroundRoute,
    )
    if (check(Boolean(tryRoute), 'no built doc page carries a "Try in playground" button')) {
      const guide = await open(tryRoute, `try:${tryRoute}`)
      const button = guide.locator('.try-button').first()
      const fence = await button.getAttribute('data-code')
      check(Boolean(fence), `${tryRoute}: the first try button carries no source`)
      await button.click({ force: true })
      await guide.waitForFunction(() => location.hash.startsWith('#code='), null, {
        timeout: 15_000,
      })
      check(
        new URL(guide.url()).pathname.endsWith(playgroundRoute),
        `${tryRoute}: the try button landed on ${guide.url()}`,
      )
      await waitForParse(guide)
      const loaded = await guide.inputValue('#demo-input')
      check(
        loaded.trim() === (fence ?? '').trim(),
        `${tryRoute}: the playground did not load the fence the button carried`,
      )
      notes.push(`try button on ${tryRoute} loaded ${loaded.split('\n').length} lines into the playground`)
    }

    const quickStartRoutes = await pagesWith('data-widget="link-rewrite"')
    const quickStartRoute = quickStartRoutes.find((route) => route === '/guide/quick-start')
    if (check(Boolean(quickStartRoute), '/guide/quick-start has no link-rewrite widget')) {
      const quickStart = await open(quickStartRoute, 'quick-start link rewrite')
      const widget = quickStart.locator('[data-widget="link-rewrite"]').first()
      await widget.scrollIntoViewIfNeeded()
      const textarea = widget.locator('.ex-editor')
      await textarea.waitFor({ state: 'visible', timeout: 30_000 })
      await textarea.press('End')
      await textarea.type(' ')
      await quickStart.waitForFunction(
        () =>
          document.querySelector('[data-widget="link-rewrite"] .ex-editor-layer .ex-source')
            ?.textContent === document.querySelector('[data-widget="link-rewrite"] .ex-editor')?.value &&
          Boolean(
            document.querySelector(
              '[data-widget="link-rewrite"] .ex-editor-layer .ex-source span[style*="--shiki-light"]',
            ),
          ),
        null,
        { timeout: 15_000 },
      )
      check(
        (await widget.locator('.ex-editor-layer .ex-source span[style*="--shiki-light"]').count()) > 0,
        '/guide/quick-start: typing left the link-rewrite code layer without real Shiki token spans',
      )
    }

    // ---- the engine-backed guide figures ----
    const figureStatus = (page, selector) =>
      page.evaluate(
        (marker) =>
          document.querySelector(`${marker} [data-ex-status]`)?.textContent?.trim() ?? '',
        selector,
      )
    const waitForFigure = (page, selector, pattern) =>
      page.waitForFunction(
        ([marker, source]) =>
          new RegExp(source).test(
            document.querySelector(`${marker} [data-ex-status]`)?.textContent ?? '',
          ),
        [selector, pattern.source],
        { timeout: 30_000 },
      )

    const astRoute = await pageCarrying('data-ast-explorer', 'ast explorer')
    if (astRoute) {
      const parserPage = await open(astRoute)
      await parserPage.locator('[data-ast-explorer]').first().scrollIntoViewIfNeeded()
      await waitForFigure(parserPage, '[data-ast-explorer]', /nodes/)
      notes.push(`ast explorer on ${astRoute}: ${await figureStatus(parserPage, '[data-ast-explorer]')}`)
      await parserPage.locator('[data-ast-explorer] .ex-tree button').nth(2).hover()
      const hitCount = await parserPage.locator('[data-ast-explorer] .ex-seg.ex-hit').count()
      check(hitCount > 0, `${astRoute}: hovering an AST row highlighted no source`)
      const astReadout = await parserPage.textContent('[data-ast-explorer] [data-ex-readout]')
      check(/spans \d+:\d+/.test(astReadout), `${astRoute}: hovering an AST row showed no span readout: ${astReadout}`)

      if (astRoute === '/guide/parse') {
        const textarea = parserPage.locator('[data-ast-explorer] .ex-editor')
        const before = await textarea.inputValue()
        await textarea.focus()
        await textarea.press('End')
        await textarea.press('Space')
        await parserPage.waitForFunction(
          () => {
            const input = document.querySelector('[data-ast-explorer] .ex-editor')
            const mirror = document.querySelector('[data-ast-explorer] .ex-editor-layer .ex-source')
            return input && mirror?.textContent === input.value
          },
          null,
          { timeout: 5_000 },
        )
        const after = await textarea.inputValue()
        check(after !== before, '/guide/parse: typing in the explorer did not change its source')
        const tokenCount = await parserPage
          .locator('[data-ast-explorer] .ex-editor-layer .ex-source span[style*="--shiki-light"]')
          .count()
        check(tokenCount > 0, '/guide/parse: the editable source has no highlighted token spans')
        check(await parserPage.locator('[data-ast-explorer] [data-ex-reset]').isVisible(), '/guide/parse: Reset source did not appear after typing')
        await parserPage.mouse.move(0, 0)
        const restingScrollTop = await parserPage
          .locator('[data-ast-explorer] [data-ex-out]')
          .evaluate((pane) => pane.scrollTop)
        check(restingScrollTop === 0, `/guide/parse: the AST tree rests at scrollTop ${restingScrollTop}`)
      }
    }

    const symbolRoute = await pageCarrying('data-symbol-explorer', 'symbol explorer')
    if (symbolRoute) {
      const analyzerPage = await open(symbolRoute)
      await analyzerPage.locator('[data-symbol-explorer]').first().scrollIntoViewIfNeeded()
      await waitForFigure(analyzerPage, '[data-symbol-explorer]', /resolves to nothing|resolves to a declaration/)
      notes.push(
        `symbol explorer on ${symbolRoute}: ${await figureStatus(analyzerPage, '[data-symbol-explorer]')}`,
      )
      const symbolRow = await analyzerPage.evaluate(() => {
        const rows = [...document.querySelectorAll('[data-symbol-explorer] tr[data-ex-symbol]')]
        const wanted = rows.find((row) => row.querySelector('td')?.textContent?.trim() === 'item')
        return Number((wanted ?? rows[0])?.dataset.exSymbol ?? -1)
      })
      check(symbolRow >= 0, `${symbolRoute}: the symbol table has no rows`)
      await analyzerPage.locator(`[data-symbol-explorer] tr[data-ex-symbol="${symbolRow}"]`).click()
      const declCount = await analyzerPage.locator('[data-symbol-explorer] .ex-decl').count()
      const refCount = await analyzerPage.locator('[data-symbol-explorer] .ex-ref').count()
      check(declCount >= 1, `${symbolRoute}: the selected symbol lit no declaration`)
      check(refCount >= 1, `${symbolRoute}: the selected symbol lit no reference`)
      const scopeRows = await analyzerPage.locator('[data-symbol-explorer] [data-ex-scope]').count()
      check(scopeRows >= 3, `${symbolRoute}: the scope tree has ${scopeRows} rows, expected 3 or more`)
      notes.push(`symbol click lit ${declCount} declaration and ${refCount} reference segments`)
    }

    const codegenRoute = await pageCarrying('data-codegen-walkthrough', 'codegen walkthrough')
    if (codegenRoute) {
      const codegenPage = await open(codegenRoute)
      await codegenPage.locator('[data-codegen-walkthrough]').first().scrollIntoViewIfNeeded()
      await waitForFigure(codegenPage, '[data-codegen-walkthrough]', /generated in/)
      const generated = codegenPage.locator('[data-codegen-walkthrough] [data-ex-generated]')
      const prettyOutput = await generated.textContent()
      check(
        prettyOutput.includes('\n  ') && prettyOutput.includes('total === 0'),
        `${codegenRoute}: the default output is not indented, so pretty is not the default`,
      )
      await codegenPage.click('[data-codegen-walkthrough] [data-ex-value="compact"]')
      await codegenPage.waitForFunction(
        (previous) =>
          (document.querySelector('[data-codegen-walkthrough] [data-ex-generated]')?.textContent ??
            '') !== previous,
        prettyOutput,
        { timeout: 15_000 },
      )
      const compactOutput = await generated.textContent()
      // Compact keeps the markup's own line breaks (JSX text is significant)
      // and drops the discretionary whitespace, which is what these two read.
      check(
        compactOutput.includes('total===0') && !compactOutput.includes('total === 0'),
        `${codegenRoute}: the compact output still spaces its operators`,
      )
      check(
        compactOutput.length < prettyOutput.length,
        `${codegenRoute}: compact output is not shorter than pretty (${compactOutput.length} vs ${prettyOutput.length})`,
      )
      await codegenPage.locator('[data-codegen-walkthrough] [data-ex-flag="strip"]').focus()
      await codegenPage.locator('[data-codegen-walkthrough] [data-ex-flag="strip"]').press('Space')
      await codegenPage.waitForFunction(
        (previous) =>
          (document.querySelector('[data-codegen-walkthrough] [data-ex-generated]')?.textContent ??
            '') !== previous,
        compactOutput,
        { timeout: 15_000 },
      )
      const strippedOutput = await generated.textContent()
      check(strippedOutput !== compactOutput, `${codegenRoute}: strip did not change the generated source`)
      check(
        (await codegenPage.getAttribute('[data-codegen-walkthrough] [data-ex-flag="strip"]', 'aria-checked')) === 'true',
        `${codegenRoute}: Strip types switch did not announce its state`,
      )
      check(
        await codegenPage
          .locator('[data-codegen-walkthrough] [data-ex-value="shortest"]')
          .isDisabled(),
        `${codegenRoute}: the shortest quotes chip is not disabled`,
      )
      const call = await codegenPage.textContent('[data-codegen-walkthrough] .ex-call')
      check(
        call.includes('format: "compact"'),
        `${codegenRoute}: the equivalent call does not name the compact format: ${call}`,
      )
      notes.push(`codegen walkthrough: ${call.trim()}`)
    }

    // ---- the how-it-works step-through ----
    const hiwRoute = await pageCarrying('data-how-it-works', 'how-it-works')
    if (hiwRoute) {
      const introPage = await open(hiwRoute)
      const hiwSteps = introPage.locator('[data-how-it-works] [data-hiw-step]')
      const stepCount = await hiwSteps.count()
      check(stepCount === 5, `${hiwRoute}: ${stepCount} steps, expected 5`)
      await hiwSteps.nth(1).click()
      const step = await introPage.getAttribute('[data-how-it-works]', 'data-step')
      check(step === 'hooks', `${hiwRoute}: the second step selected "${step}", expected hooks`)
      const visiblePanels = await introPage.$$eval('[data-hiw-panel]', (nodes) =>
        nodes.filter((node) => node.offsetParent !== null).map((node) => node.dataset.hiwPanel),
      )
      check(
        visiblePanels.length === 1 && visiblePanels[0] === 'hooks',
        `${hiwRoute}: visible panels are ${visiblePanels.join(', ') || 'none'}, expected only hooks`,
      )
      const hookChips = await introPage.locator('[data-hiw-panel="hooks"] code').count()
      check(
        hookChips === 20,
        `${hiwRoute}: the hooks panel shows ${hookChips} chips, expected the 20 in parser_extension.zig`,
      )
      notes.push(`how-it-works on ${hiwRoute}: ${stepCount} steps, ${hookChips} hook chips`)
    }

    // ---- the chooser and the recorded transcripts ----
    const chooserRoute = await pageCarrying('data-chooser', 'chooser')
    if (chooserRoute) {
      const startPage = await open(chooserRoute)
      // interactive.js is a dynamic import; data-ready is the only honest
      // signal that a click will land.
      await startPage.waitForSelector('[data-chooser][data-ready]', { timeout: 30_000 })
      const options = startPage.locator('[data-chooser] [data-chooser-option]')
      const optionCount = await options.count()
      check(optionCount >= 2, `${chooserRoute}: ${optionCount} chooser options, expected 2 or more`)
      await options.nth(1).click()
      const shownPanels = await startPage.$$eval('[data-chooser-panel]', (nodes) =>
        nodes.filter((node) => !node.hidden).map((node) => node.dataset.chooserPanel),
      )
      check(
        shownPanels.length === 1 && shownPanels[0] === '1',
        `${chooserRoute}: chooser shows panel(s) ${shownPanels.join(', ') || 'none'}, expected only 1`,
      )
    }

    const terminalRoute = await pageCarrying('data-terminal-demo', 'terminal demo')
    if (terminalRoute) {
      const terminalPage = await open(terminalRoute)
      const terminals = terminalPage.locator('[data-terminal-demo]')
      const terminalCount = await terminals.count()
      check(terminalCount >= 1, `${terminalRoute}: no terminal demo rendered`)
      // The recording plays a line at a time, so "it played" means every line
      // is visible again at the end and the button offers a replay.
      const terminal = terminals.last()
      await terminal.scrollIntoViewIfNeeded()
      await terminal.locator('[data-terminal-play]').click()
      await terminalPage.waitForFunction(
        () => {
          const all = document.querySelectorAll('[data-terminal-demo]')
          const last = all[all.length - 1]
          if (!last || last.dataset.playing) return false
          return [...last.querySelectorAll('.gs-terminal-line')].every(
            (line) => !line.classList.contains('gs-terminal-line-hidden'),
          )
        },
        null,
        { timeout: 30_000 },
      )
      const played = await terminal.locator('.gs-terminal-transcript').textContent()
      check(played.includes('# exit 0'), `${terminalRoute}: the transcript has no exit status`)
      // The text on screen is a committed recording, not a retelling: every
      // output line of the transcript whose caption is on screen must be there.
      const name = await terminal.getAttribute('data-terminal-demo')
      const transcriptsDir = path.join(docsDir, 'transcripts')
      const recordings = await Promise.all(
        (await readdir(transcriptsDir))
          .filter((name) => name.endsWith('.json'))
          .map(async (file) => ({ name: file.slice(0, -'.json'.length), ...JSON.parse(await readFile(path.join(transcriptsDir, file), 'utf8')) })),
      )
      const recording = recordings.find((candidate) => candidate.name === name)
      if (check(Boolean(recording), `${terminalRoute}: no committed transcript is named "${name}"`)) {
        for (const entry of recording.transcript) {
          check(played.includes(entry.command), `${terminalRoute}: the played transcript is missing the command ${entry.command}`)
          check(entry.exit_code === 0, `docs/transcripts: ${entry.command} is committed with exit ${entry.exit_code}`)
          for (const line of entry.output.split('\n').filter(Boolean)) {
            check(played.includes(line), `${terminalRoute}: the played transcript is missing the output line "${line}"`)
          }
        }
        notes.push(`terminal demo on ${terminalRoute}: ${recording.transcript.length} commands, ${name}`)
      }
    }

    // ---- the node-type chips under every example of a node-chips page ----
    const chipsRoute = await pageCarrying('node-chips-note', 'node chips')
    if (chipsRoute) {
      const syntaxPage = await open(chipsRoute)
      const chipRows = await syntaxPage.$$eval('.node-chips:not([data-ct-chips])', (nodes) =>
        nodes.map((node) =>
          [...node.querySelectorAll('.node-chip')].map((chip) => chip.textContent.trim()),
        ),
      )
      check(chipRows.length >= 1, `${chipsRoute}: no chip rows under the examples`)
      const namedTypes = new Set(chipRows.flat().filter((chip) => /^[A-Z][A-Za-z]+/.test(chip)))
      check(namedTypes.size >= 1, `${chipsRoute}: the chips name no node type`)
      notes.push(`node chips on ${chipsRoute}: ${chipRows.length} examples, ${namedTypes.size} distinct node types`)
    }

    // ---- the filterable extension-point matrix ----
    const matrixRoute = await pageCarrying('data-matrix-filter', 'hook matrix')
    if (matrixRoute) {
      const dialectPage = await open(matrixRoute)
      await dialectPage.waitForSelector('[data-matrix-filter][data-ready]', { timeout: 30_000 })
      const hookRows = dialectPage.locator('[data-matrix-filter] tr[data-classification]')
      const hookRowCount = await hookRows.count()
      check(hookRowCount === 20, `${matrixRoute}: ${hookRowCount} hook rows, expected 20`)
      const implemented = await dialectPage.$$eval(
        '[data-matrix-filter] tr[data-classification]',
        (rows) => rows.map((row) => row.children[2]?.textContent?.trim() ?? ''),
      )
      check(
        implemented.every((cell) => cell.endsWith('.zig')),
        `${matrixRoute}: an "Implemented in" cell does not name a zig file: ${implemented.join(' | ')}`,
      )
      await dialectPage.click('[data-matrix-filter] [data-matrix-chip="jsx"]')
      const visibleRows = await dialectPage.$$eval(
        '[data-matrix-filter] tr[data-classification]',
        (rows) => rows.filter((row) => !row.hidden).map((row) => row.dataset.classification),
      )
      check(
        visibleRows.length === 7 && visibleRows.every((area) => area === 'jsx'),
        `${matrixRoute}: filtering by JSX left ${visibleRows.length} rows (${[...new Set(visibleRows)].join(', ')}), expected 7 JSX rows`,
      )
      const matrixStatus = (
        await dialectPage.textContent('[data-matrix-filter] [data-matrix-status]')
      ).trim()
      check(matrixStatus.includes('Showing 7 of 20 hooks'), `${matrixRoute}: the status line reads "${matrixStatus}"`)
      notes.push(`hook matrix on ${matrixRoute}: ${hookRowCount} rows, ${matrixStatus}`)
    }

    // ---- measure in this tab ----
    const benchRoute = await pageCarrying('data-bench-live', 'bench live')
    if (benchRoute) {
      const benchPage = await open(benchRoute)
      const benchFigure = benchPage.locator('[data-bench-live]').first()
      const caveat = benchPage.locator('[data-bench-live] .bench-live-caveat').first()
      check(await caveat.isVisible(), `${benchRoute}: the benchmark intro is not visible`)
      check(
        (await caveat.textContent()).includes('It is not the native-addon report above'),
        `${benchRoute}: the intro does not distinguish this run from the report above`,
      )
      // Nothing in this figure may repeat a number from the committed table.
      const figureText = await benchFigure.textContent()
      for (const committed of ['29,666', '103,075', '33,708', '9,702', '0.2878']) {
        check(!figureText.includes(committed), `${benchRoute}: the in-tab figure repeats ${committed} from the committed table`)
      }
      await benchFigure.scrollIntoViewIfNeeded()
      await benchPage.waitForSelector('[data-bench-live][data-bench-state="ready"]', { timeout: 60_000 })
      const automatic = await benchPage.$$eval(
        '[data-bench-live] [data-bench-median], [data-bench-live] [data-bench-p95], [data-bench-live] [data-bench-rate], [data-bench-live] [data-bench-throughput]',
        (nodes) => nodes.map((node) => node.textContent.trim()),
      )
      check(
        automatic.length === 4 && automatic.every((value) => /^\d/.test(value)),
        `${benchRoute}: the automatic results are ${automatic.join(' | ') || 'missing'}`,
      )
      await benchPage.click('[data-bench-live] [data-bench-iterations="100"]')
      await benchPage.click('[data-bench-live] [data-bench-run]')
      await benchPage.waitForFunction(
        () => document.querySelector('[data-bench-live]')?.textContent?.includes('of 100 asked for'),
        null,
        { timeout: 60_000 },
      )
      const measured = await benchPage.$$eval(
        '[data-bench-live] [data-bench-median], [data-bench-live] [data-bench-p95], [data-bench-live] [data-bench-rate], [data-bench-live] [data-bench-throughput]',
        (nodes) => nodes.map((node) => node.textContent.trim()),
      )
      check(
        measured.length === 4 && measured.every((value) => /^\d/.test(value)),
        `${benchRoute}: the results are ${measured.join(' | ') || 'missing'}`,
      )
      const benchStatus = (await benchPage.textContent('[data-bench-live] [data-ex-status]')).trim()
      check(benchStatus.includes('parses completed'), `${benchRoute}: the status line does not summarize the completed run: ${benchStatus}`)
      check(benchStatus.includes('runs in your browser'), `${benchRoute}: the status line does not say where it ran: ${benchStatus}`)
      notes.push(`bench live on ${benchRoute}: automatic median ${automatic[0]} ns; rerun median ${measured[0]} ns, ${measured[2]} parses/s, ${benchStatus}`)
    }

    // ---- retired routes land on their replacements ----
    const vercel = JSON.parse(await readFile(path.join(distDir, 'vercel.json'), 'utf8'))
    const retired = vercel.redirects.filter((rule) => rule.permanent && !rule.source.endsWith('.md'))
    check(retired.length > 0, 'vercel.json carries no permanent redirects for the retired routes')
    // Asked over HTTP without following: what is checked is the status and the
    // Location the server sends, which is what a crawler or an old link sees.
    for (const rule of retired) {
      const response = await context.request.get(`${origin}${rule.source}`, { maxRedirects: 0 })
      const location = response.headers().location ?? ''
      check(
        [301, 308].includes(response.status()) && location === rule.destination,
        `redirect: ${rule.source} answered ${response.status()} ${location || 'with no Location'}, expected a permanent redirect to ${rule.destination}`,
      )
      const landing = await context.request.get(`${origin}${rule.destination}`, { maxRedirects: 0 })
      check(landing.ok(), `redirect: ${rule.destination} answers ${landing.status()}`)
    }
    notes.push(`redirects: ${retired.length} retired routes land on their replacements`)

    // ---- the router swaps the routed region in place, both directions ----
    const firstDoc = config.sidebar[0].items[0].link
    const spa = await open(firstDoc, 'spa')
    await spa.click(`.top-nav a[href$="${playgroundRoute}"]`)
    await spa.waitForFunction(() => Boolean(document.getElementById('demo-input')), null, {
      timeout: 15_000,
    })
    await waitForParse(spa)
    check(
      new URL(spa.url()).pathname.endsWith(playgroundRoute),
      `spa: forward navigation landed on ${spa.url()}`,
    )
    await spa.click(`.top-nav a[href$="${firstDoc}"]`)
    await spa.waitForFunction(() => !document.getElementById('demo-input'), null, { timeout: 15_000 })
    await spa.click(`.top-nav a[href$="${playgroundRoute}"]`)
    await spa.waitForFunction(() => Boolean(document.getElementById('demo-input')), null, {
      timeout: 15_000,
    })
    await waitForParse(spa)
    notes.push(`spa round trip status: ${await statusText(spa)}`)

    // Each widget may ship docs/widgets/NAME.verify.mjs exporting
    // `default async ({ open, pagesWith, pageCarrying, check, notes, skipped, waitForParse, statusText })`.
    const widgetsDir = path.join(docsDir, 'widgets')
    const verifiers = (await readdir(widgetsDir)).filter((f) => f.endsWith('.verify.mjs')).sort()
    for (const file of verifiers) {
      const name = file.replace(/\.verify\.mjs$/, '')
      const routes = await pagesWith(`data-widget="${name}"`)
      if (routes.length === 0) {
        skipped.push(`${name}: no built page carries data-widget="${name}"`)
        continue
      }
      const verify = (await import(pathToFileURL(path.join(widgetsDir, file)).href)).default
      const before = failures.length
      await verify({ routes, open, pagesWith, pageCarrying, check, notes, skipped, waitForParse, statusText })
      notes.push(`${name}: verified on ${routes.join(', ')}${failures.length > before ? ' with problems' : ''}`)
    }
  } finally {
    await browser.close()
    server?.stop()
  }

  const wasm = await stat(path.join(siteDir, 'assets', 'wasm', 'yuku-tsrx.wasm')).catch(() => null)
  if (wasm) notes.push(`wasm: ${(wasm.size / 1024).toFixed(0)} KiB in docs/dist`)
}

await main()

console.log('playground verification')
for (const note of notes) console.log(`  ${note}`)
for (const skip of skipped) console.log(`  skipped: ${skip}`)
if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exitCode = 1
} else {
  console.log(
    `\nok: hero editor, ${playgroundRoute}, all four tabs, the try button, the redirects work with no console errors`,
  )
}
