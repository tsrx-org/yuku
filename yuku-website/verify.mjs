// Opens the built site in Chrome and checks every page loads clean and the editor runs @tsrx/yuku. Run: node verify.mjs
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import config from './site.config.mjs'

const docsDir = path.dirname(fileURLToPath(import.meta.url))

const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].find((candidate) => candidate && existsSync(candidate))
if (!chrome) throw new Error('no Chrome found: set CHROME_PATH')

const server = spawn(process.execPath, [path.join(docsDir, 'serve.mjs'), '0'], { stdio: ['ignore', 'pipe', 'inherit'] })
const origin = await new Promise((resolve, reject) => {
  server.stdout.on('data', (chunk) => {
    const match = /http:\/\/127\.0\.0\.1:\d+/.exec(String(chunk))
    if (match) resolve(match[0])
  })
  server.on('exit', (code) => reject(new Error(`serve.mjs exited with ${code}`)))
})

const browser = await chromium.launch({ executablePath: chrome })
const failures = []
const unversioned = new Set()
const routes = ['/', config.playground, ...new Set(config.sidebar.flatMap((group) => group.items.map((item) => item.link)))]

try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    for (const colorScheme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport, colorScheme })
      page.on('pageerror', (error) => failures.push(`${page.url()}: ${error.message}`))
      page.on('console', (message) => {
        if (message.type() === 'error') failures.push(`${page.url()}: ${message.text()}`)
      })
      page.on('requestfailed', (request) => failures.push(`${request.url()}: ${request.failure()?.errorText}`))
      page.on('request', (request) => {
        const url = new URL(request.url())
        if (url.origin === origin && url.pathname.startsWith('/assets/') && !/^\/assets\/[0-9a-f]{12}\//.test(url.pathname)) unversioned.add(url.pathname)
      })
      for (const route of routes) {
        const response = await page.goto(origin + route)
        if (response?.status() !== 200) failures.push(`${route}: HTTP ${response?.status()}`)
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        if (overflow > 1) failures.push(`${route} at ${viewport.width}px: scrolls sideways by ${overflow}px`)
      }
      await page.close()
    }
  }

  const page = await browser.newPage()
  await page.goto(`${origin}/`)
  await page.waitForFunction(() => /^parsed in/.test(document.getElementById('demo-status')?.textContent ?? ''), null, { timeout: 15000 })
  const status = await page.textContent('#demo-status')
  if (!status.includes('0 diagnostics')) failures.push(`home editor: ${status}`)
  for (const tab of ['generated', 'semantic']) {
    await page.click(`#pg-tab-${tab}`)
    await page.waitForFunction((id) => (document.getElementById(`pg-${id}`)?.textContent ?? '').length > 0, tab)
  }
  if (!(await page.textContent('#pg-generated')).includes('@for (const item of items; key item.id)')) {
    failures.push('home editor: generate did not print the @for')
  }
  if (!(await page.textContent('#pg-semantic')).includes('item')) failures.push('home editor: no binding for item')

  // the playground's #code= hash names no element, so the swap must still start at the top
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${origin}/guide/parse`)
  await page.waitForFunction(() => document.documentElement.dataset.afterFirstLoad === 'true')
  await page.evaluate(() => document.querySelector('.try-button').scrollIntoView())
  await page.evaluate(() => document.querySelector('.try-button').click())
  await page.waitForURL(/\/playground#code=/)
  await page.waitForFunction(() => document.getElementById('demo-editor') !== null)
  const scrolled = await page.evaluate(() => window.scrollY)
  if (scrolled !== 0) failures.push(`Try in playground: the playground opened scrolled to ${scrolled}px`)
  await page.setViewportSize({ width: 1440, height: 900 })

  await page.goto(`${origin}${config.playground}`)
  await page.waitForFunction(() => /^parsed in/.test(document.getElementById('demo-status')?.textContent ?? ''), null, { timeout: 15000 })
  await page.click('#pg-scenario-two-nodes')
  await page.click('#pg-tab-diagnostics')
  await page.waitForFunction(() => (document.getElementById('pg-diagnostics')?.textContent ?? '').includes('TSRX2011'), null, { timeout: 5000 })
  await page.close()
} catch (error) {
  failures.push(error.message)
} finally {
  await browser.close()
  server.kill()
}

// every asset comes from the build's hashed directory, the only place cached as immutable
for (const asset of unversioned) failures.push(`${asset} is fetched outside /assets/<hash>/`)

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`verified ${routes.length} pages at 2 widths in light and dark, and the editor and playground`)
