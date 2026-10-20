// yuku-tsrx docs client, vanilla JS: theme, nav drawer, copy, outline,
// search, and Navigation-API SPA routing (progressive enhancement).

// ---------- theme toggle (persistent chrome) ----------
const themeToggle = document.getElementById('theme-toggle')
const root = document.documentElement
root.dataset.assetVersion = new URL(import.meta.url).search

function syncThemeButton() {
  themeToggle.setAttribute('aria-pressed', String(root.classList.contains('dark')))
}

syncThemeButton()

themeToggle.addEventListener('click', () => {
  const dark = root.classList.toggle('dark')
  try {
    localStorage.setItem('yuku-tsrx-theme', dark ? 'dark' : 'light')
  } catch {}
  syncThemeButton()
})

const afterFirstLoadQueue = []
let firstLoadFlushed = false

function flushAfterFirstLoad() {
  if (firstLoadFlushed) return
  firstLoadFlushed = true
  for (const type of ['pointerdown', 'keydown', 'touchstart']) {
    window.removeEventListener(type, flushAfterFirstLoad, true)
  }
  root.dataset.afterFirstLoad = 'true'
  window.dispatchEvent(new Event('yuku-after-first-load'))
  for (const callback of afterFirstLoadQueue.splice(0)) callback()
}

function afterFirstLoad(callback) {
  if (firstLoadFlushed) callback()
  else afterFirstLoadQueue.push(callback)
}

const scheduleAfterFirstLoad = () => {
  setTimeout(() => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(flushAfterFirstLoad)
    else setTimeout(flushAfterFirstLoad)
  }, 200)
}

if (document.readyState === 'complete') scheduleAfterFirstLoad()
else window.addEventListener('load', scheduleAfterFirstLoad, { once: true })
for (const type of ['pointerdown', 'keydown', 'touchstart']) {
  window.addEventListener(type, flushAfterFirstLoad, { capture: true, passive: true })
}

// ---------- mobile sidebar drawer (sidebar/backdrop are per-page, so query lazily) ----------
const menuToggle = document.getElementById('menu-toggle')

function setSidebarOpen(open) {
  const backdrop = document.getElementById('sidebar-backdrop')
  if (!backdrop) return
  document.body.classList.toggle('sidebar-open', open)
  menuToggle.setAttribute('aria-expanded', String(open))
  backdrop.hidden = !open
}

if (menuToggle) {
  menuToggle.addEventListener('click', () =>
    setSidebarOpen(!document.body.classList.contains('sidebar-open')),
  )
  document.addEventListener('click', (event) => {
    if (event.target.id === 'sidebar-backdrop') setSidebarOpen(false)
  })
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && document.body.classList.contains('sidebar-open')) {
      setSidebarOpen(false)
      menuToggle.focus()
    }
  })
}

window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return
  for (const list of document.querySelectorAll('.page-menu-list:not([hidden])')) {
    list.hidden = true
    list.closest('.page-menu')?.querySelector('.page-menu-toggle')?.setAttribute('aria-expanded', 'false')
  }
})

// ---------- per-page: copy buttons on code blocks ----------
// The button swaps its own glyph to a tick on a successful copy, because colour
// alone said "copied" to nobody who does not already know the button.
const COPY_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>'
const COPIED_ICON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'

function initCopyButtons() {
  for (const block of document.querySelectorAll('.code-block')) {
    if (block.querySelector('.copy-button')) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'copy-button'
    button.setAttribute('aria-label', 'Copy code to clipboard')
    button.innerHTML = COPY_ICON
    // A second copy before the first has reset would otherwise be cut short by
    // the older timer.
    let resetTimer
    button.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(block.querySelector('code').textContent.trimEnd())
        button.classList.add('copied')
        button.innerHTML = COPIED_ICON
        button.setAttribute('aria-label', 'Copied')
        clearTimeout(resetTimer)
        resetTimer = setTimeout(() => {
          button.classList.remove('copied')
          button.innerHTML = COPY_ICON
          button.setAttribute('aria-label', 'Copy code to clipboard')
        }, 3000)
      } catch {}
    })
    block.appendChild(button)
  }
}

function applyPmChoice(pm) {
  for (const group of document.querySelectorAll('[data-pm-tabs]')) {
    if (!group.querySelector(`[role="tab"][data-pm="${pm}"]`)) continue
    for (const tab of group.querySelectorAll('[role="tab"]')) {
      const active = tab.dataset.pm === pm
      tab.setAttribute('aria-selected', String(active))
      tab.tabIndex = active ? 0 : -1
    }
    for (const panel of group.querySelectorAll('[role="tabpanel"]')) {
      panel.hidden = panel.dataset.pm !== pm
    }
  }
}

function initPmTabs() {
  const selectPm = (pm) => {
    try {
      localStorage.setItem('yuku-tsrx-pm', pm)
    } catch {}
    applyPmChoice(pm)
  }
  for (const group of document.querySelectorAll('[data-pm-tabs]:not([data-ready])')) {
    group.dataset.ready = '1'
    const tabs = [...group.querySelectorAll('[role="tab"]')]
    for (const tab of tabs) tab.addEventListener('click', () => selectPm(tab.dataset.pm))
    group.querySelector('[role="tablist"]').addEventListener('keydown', (event) => {
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      const index = tabs.indexOf(document.activeElement)
      if (!delta || index === -1) return
      event.preventDefault()
      const next = tabs[(index + delta + tabs.length) % tabs.length]
      next.focus()
      selectPm(next.dataset.pm)
    })
  }
  let stored = null
  try {
    stored = localStorage.getItem('yuku-tsrx-pm')
  } catch {}
  if (stored) applyPmChoice(stored)
}

const pageCleanupCallbacks = []

function cleanupPage() {
  for (const cleanup of pageCleanupCallbacks.splice(0)) cleanup()
}

// ---------- per-page: outline scroll spy (one persistent listener) ----------
let spyEntries = []
let spyActiveItem = null
let spyTicking = false

let spyProgress = null

function collectOutline() {
  spyActiveItem?.classList.remove('active')
  spyActiveItem = null
  const progress = document.querySelector('.outline-progress')
  spyProgress = progress
    ? {
        root: progress,
        fill: progress.querySelector('.outline-progress-fill'),
        readout: progress.querySelector('.outline-remaining'),
        total: Math.max(Number(progress.dataset.totalMinutes) || 0, 1),
        article: document.querySelector('article.doc'),
        text: '',
      }
    : null
  spyEntries = [...document.querySelectorAll('.outline a[href^="#"]')]
    .map((link) => ({
      item: link.parentElement,
      heading: document.getElementById(link.getAttribute('href').slice(1)),
    }))
    .filter((entry) => entry.heading)
  updateSpy()
}

function updateSpy() {
  spyTicking = false
  updateProgress()
  if (spyEntries.length === 0) return
  let current = spyEntries[0]
  for (const entry of spyEntries) {
    if (entry.heading.getBoundingClientRect().top <= 120) current = entry
    else break
  }
  if (current.item !== spyActiveItem) {
    spyActiveItem?.classList.remove('active')
    current.item.classList.add('active')
    spyActiveItem = current.item
  }
}

// How far the article itself has gone past the reading line, not how far the
// window has scrolled: a long footer or a short page would otherwise report
// progress the reader has not made.
function updateProgress() {
  if (!spyProgress?.article) return
  const { top, height } = spyProgress.article.getBoundingClientRect()
  const line = window.innerHeight * 0.35
  const scrollable = Math.max(height - (window.innerHeight - line), 1)
  // The reading line sits below the top of the article, so an unscrolled page
  // measures a few percent. A reader who has not scrolled has not started.
  const read =
    window.scrollY < 8 ? 0 : Math.min(Math.max((line - top) / scrollable, 0), 1)
  spyProgress.fill.style.width = `${(read * 100).toFixed(1)}%`
  const left = Math.ceil(spyProgress.total * (1 - read))
  const text = read === 0 ? `${spyProgress.total} min read` : left <= 0 ? 'Finished' : `${left} min left`
  if (spyProgress.text !== text) {
    spyProgress.text = text
    spyProgress.readout.textContent = text
  }
}

window.addEventListener(
  'scroll',
  () => {
    if (!spyTicking) {
      spyTicking = true
      requestAnimationFrame(updateSpy)
    }
  },
  { passive: true },
)

function initPage() {
  initCopyButtons()
  initPmTabs()
  collectOutline()
  // The hero panel and the /playground workbench are the same component. It
  // pulls in the WebAssembly build of the dialect, so it is only fetched on a
  // page that actually has one, and its timers are cleared when an SPA
  // navigation takes the panel away.
  const demo = document.getElementById('hero-demo')
  if (demo && !demo.dataset.ready) {
    demo.dataset.ready = '1'
    let dispose = null
    let disposed = false
    let ready = false
    let pendingScenario = null
    const rememberScenario = (event) => {
      const button = event.target.closest?.('[data-scenario]')
      if (!ready && button && demo.closest('main')?.contains(button)) pendingScenario = button
    }
    demo.closest('main')?.addEventListener('click', rememberScenario)
    afterFirstLoad(() => {
      if (disposed) return
      import(new URL('./yuku-playground.js', import.meta.url))
        .then((module) => module.initDemo(demo))
        .then((cleanup) => {
          dispose = cleanup
          ready = true
          if (disposed) dispose?.()
          else pendingScenario?.click()
          pendingScenario = null
        })
        .catch(() => {})
    })
    pageCleanupCallbacks.push(() => {
      disposed = true
      demo.closest('main')?.removeEventListener('click', rememberScenario)
      dispose?.()
    })
  }
  // The home comparison chart paints a rocket-fuel plume into each lane with
  // WebGL. The CSS gradient in .comp-fill is the whole story without it, so the
  // module is only fetched when the chart is about to be on screen, and never
  // when the reader has asked for reduced motion.
  const fuelRows = document.querySelectorAll(
    '.comp-row[data-key="yukuTsrx"], .comp-row[data-key="tsrxCore"]',
  )
  const chart = document.querySelector('.comp-chart')
  if (
    fuelRows.length &&
    chart &&
    !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        io.disconnect()
        afterFirstLoad(() => {
          import(new URL('./fuel.js', import.meta.url))
            .then((module) => module.init(fuelRows, pageCleanupCallbacks))
            .catch(() => {})
        })
      },
      { rootMargin: '200px 0px' },
    )
    io.observe(chart)
    pageCleanupCallbacks.push(() => io.disconnect())
  }
}
initPage()

// ---------- delegated one-time handlers (survive SPA content swaps) ----------
// "Try in playground" hands a documentation fence to the live parser, so the
// source travels in the URL fragment and never leaves the browser.
const playgroundHref = () =>
  document.querySelector('.top-nav a[href$="/playground"]')?.getAttribute('href') ?? '/playground'

const toBase64Url = (text) => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

document.addEventListener('click', async (event) => {
  const tryButton = event.target.closest('.try-button')
  if (tryButton) {
    location.assign(`${playgroundHref()}#code=${toBase64Url(tryButton.dataset.code)}`)
    return
  }
  const copyMd = event.target.closest('.copy-md-button')
  if (copyMd) {
    const label = copyMd.dataset.label ?? (copyMd.dataset.label = copyMd.textContent)
    try {
      const markdown = await (await fetch(copyMd.dataset.mdHref)).text()
      await navigator.clipboard.writeText(markdown)
      copyMd.textContent = 'Copied!'
    } catch {
      copyMd.textContent = 'Copy failed'
    }
    setTimeout(() => {
      copyMd.textContent = label
    }, 2000)
    return
  }
  const menuToggleButton = event.target.closest('.page-menu-toggle')
  if (menuToggleButton) {
    const list = menuToggleButton.closest('.page-menu').querySelector('.page-menu-list')
    const open = list.hidden
    list.hidden = !open
    menuToggleButton.setAttribute('aria-expanded', String(open))
    return
  }
  // Any click outside an open page menu (or on one of its items) closes it.
  for (const list of document.querySelectorAll('.page-menu-list:not([hidden])')) {
    if (!list.contains(event.target) || event.target.closest('[role="menuitem"]')) {
      list.hidden = true
      list.closest('.page-menu')?.querySelector('.page-menu-toggle')?.setAttribute('aria-expanded', 'false')
    }
  }
  const explorerTab = event.target.closest('[data-explorer] [role="tab"]')
  if (explorerTab) {
    const explorer = explorerTab.closest('[data-explorer]')
    for (const tab of explorer.querySelectorAll('[role="tab"]')) {
      const selected = tab === explorerTab
      tab.setAttribute('aria-selected', String(selected))
      if (selected) tab.removeAttribute('tabindex')
      else tab.setAttribute('tabindex', '-1')
    }
    for (const tabPanel of explorer.querySelectorAll('[role="tabpanel"]')) {
      tabPanel.hidden = tabPanel.id !== explorerTab.getAttribute('aria-controls')
    }
  }
})

// ---------- interactive benchmark charts: tooltip on hover/focus ----------
let chartTooltip = null
function showChartTooltip(row) {
  if (!chartTooltip) {
    chartTooltip = document.createElement('div')
    chartTooltip.className = 'chart-tooltip'
    chartTooltip.setAttribute('role', 'tooltip')
    document.body.appendChild(chartTooltip)
  }
  // Dataset values are double-escaped at build time, so they stay inert here.
  const { label, result, budget, pct, pass, note, samples } = row.dataset
  // A row with no label has nothing to say. The home page's headline cards and
  // comparison lanes are .bench-row too, and a gated chart row is only one of
  // the shapes this tooltip serves, so every line below is conditional: a lane
  // that carries no budget must not be told it failed one.
  if (!label) return
  // Colour is redundant with the glyph and the word, never the only carrier:
  // "✓ pass" still reads as pass in greyscale and to a screen reader. It is
  // here so the eye lands on the verdict and the measured number first.
  const verdict = pass === 'true' ? 'pass' : 'fail'
  chartTooltip.innerHTML =
    `<strong>${label}</strong>` +
    (result
      ? `<span><span class="chart-tooltip-key">Result:</span> <span class="chart-tooltip-value">${result}</span></span>`
      : '') +
    (budget ? `<span><span class="chart-tooltip-key">Budget:</span> ${budget}</span>` : '') +
    (pass
      ? `<span>${pct ?? ''} · <span class="chart-tooltip-${verdict}">${verdict === 'pass' ? '✓ pass' : '✗ fail'}</span></span>`
      : pct
        ? `<span>${pct}</span>`
        : '') +
    (samples ? `<span class="chart-tooltip-samples">${samples}</span>` : '') +
    (note ? `<span class="chart-tooltip-note">${note}</span>` : '')
  chartTooltip.hidden = false
  const bar = row.querySelector('.bench-bar')?.getBoundingClientRect() ?? row.getBoundingClientRect()
  const width = chartTooltip.offsetWidth
  chartTooltip.style.left = `${Math.min(Math.max(8, bar.left + bar.width / 2 - width / 2), window.innerWidth - width - 8)}px`
  chartTooltip.style.top = `${Math.max(8, bar.top - chartTooltip.offsetHeight - 8)}px`
}
function hideChartTooltip() {
  if (chartTooltip) chartTooltip.hidden = true
}
function showDocHover(span) {
  if (!chartTooltip) {
    chartTooltip = document.createElement('div')
    chartTooltip.className = 'chart-tooltip'
    chartTooltip.setAttribute('role', 'tooltip')
    document.body.appendChild(chartTooltip)
  }
  chartTooltip.innerHTML = `<strong>${span.dataset.docTitle}</strong><span>${span.dataset.doc}</span>`
  chartTooltip.hidden = false
  const rect = span.getBoundingClientRect()
  const width = chartTooltip.offsetWidth
  chartTooltip.style.left = `${Math.min(Math.max(8, rect.left), window.innerWidth - width - 8)}px`
  chartTooltip.style.top = `${Math.max(8, rect.top - chartTooltip.offsetHeight - 8)}px`
}

const hoverDispatch = (event) => {
  const row = event.target.closest?.('.bench-row')
  if (row) {
    showChartTooltip(row)
    return
  }
  const doc = event.target.closest?.('.tsrx-hover')
  if (doc) showDocHover(doc)
  else hideChartTooltip()
}
document.addEventListener('mouseover', hoverDispatch)
document.addEventListener('focusin', hoverDispatch)
window.addEventListener('scroll', hideChartTooltip, { passive: true })

// Arrow-key navigation inside the explorer tablist.
document.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return
  const tab = event.target.closest?.('[data-explorer] [role="tab"]')
  if (!tab) return
  const tabs = [...tab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')]
  const index = tabs.indexOf(tab)
  const next = tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length]
  next.click()
  next.focus()
  event.preventDefault()
})

// ---------- SPA routing via the Navigation API (Chromium; others fall back to MPA) ----------
const pageCache = new Map()
// Exposed for yuku-website/verify.mjs only. Warming is proven by calling the router's
// own fetchPage and by cache STATE rather than by simulating a pointer and
// waiting for a network event: a pointer travelling to one link can prefetch
// links it crosses (after which no request ever fires for an already-warm
// path), and pointer simulation itself proved environment-sensitive on CI.
window.__pageCache = pageCache
window.__warmPage = (href) => fetchPage(href)

async function fetchPage(href) {
  const url = new URL(href)
  if (!pageCache.has(url.pathname)) {
    const response = await fetch(url.href)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    pageCache.set(url.pathname, await response.text())
  }
  return pageCache.get(url.pathname)
}

// Each shell ships its own stylesheet (CSS_SHELLS in yuku-website/build.mjs), and the
// head is not part of the routed region, so swapping the body alone leaves the
// destination page wearing the origin shell's CSS: a doc page laid out by the
// home rules, forward and on every back/forward traversal. The head has to be
// reconciled too, and it has to happen before the swap so nothing is ever
// painted, or measured by initPage(), under the wrong rules.
//
// Two taps in quick succession turn that reconciliation into a shared-resource
// problem. The second navigation supersedes the first, but the first keeps
// running, and its idea of "stale" is a snapshot of the head taken before the
// winner existed, so it deleted the winner's stylesheet, and the winner, still
// waiting on a load event from a link that no longer existed, waited out the
// full timeout and then deleted the loser's. The live page was left with an
// empty <head> and its body text in Times, permanently, which is worse than the
// wrong-shell render this whole block exists to prevent.
//
// So exactly one navigation owns document.head at a time:
//   - every head mutation is guarded by a generation check, and a superseded
//     navigation performs none of them (it cannot know what the winner wants);
//   - the owner reconciles against the LIVE head instead of a snapshot, so a
//     link a superseded navigation left behind is cleaned up by whoever wins;
//   - removing a link settles its pending load immediately, because a detached
//     link never fires load or error and nothing may block on one.
const STYLESHEET_TIMEOUT_MS = 4000

const stylesheetLinks = (root) => [...root.querySelectorAll('link[rel="stylesheet"]')]

// Every intercepted navigation takes a ticket in dispatch order. Only the
// holder of the newest one may touch the head; the rest unwind without a trace.
let navigationGeneration = 0
function claimNavigation(signal) {
  const generation = ++navigationGeneration
  // event.signal aborts the moment a newer navigation starts, so it agrees with
  // the counter; it is read as well because it also covers a navigation that was
  // cancelled outright and never replaced.
  return () => navigationGeneration === generation && signal?.aborted !== true
}

// href -> the link this router appended for it and that link's pending or
// settled load. A navigation that adopts a link an earlier one appended waits on
// the same load instead of assuming it is ready, so a stylesheet cannot be
// committed while it is still in flight or after it has failed.
const stylesheetLoads = new Map()
// The settle function of every in-flight link, so detaching one resolves its
// waiters at once instead of leaving them to time out.
const stylesheetSettles = new WeakMap()

function appendStylesheet(href) {
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = href
  const load = new Promise((resolve) => {
    let done = false
    const settle = (outcome) => {
      if (done) return
      done = true
      clearTimeout(timer)
      stylesheetSettles.delete(link)
      resolve(outcome)
    }
    // A stylesheet that never answers must not wedge the router. Navigating
    // with it still pending is safe: it is already in the head and applies the
    // moment it lands.
    const timer = setTimeout(() => settle('timeout'), STYLESHEET_TIMEOUT_MS)
    link.addEventListener('load', () => settle('load'), { once: true })
    link.addEventListener('error', () => settle('error'), { once: true })
    stylesheetSettles.set(link, settle)
  })
  const entry = { link, load }
  stylesheetLoads.set(href, entry)
  document.head.append(link)
  return entry
}

// The only way a stylesheet link ever leaves the head.
function removeStylesheet(link) {
  stylesheetSettles.get(link)?.('detached')
  const href = link.href
  if (stylesheetLoads.get(href)?.link === link) stylesheetLoads.delete(href)
  link.remove()
}

// Waits for the stylesheets the destination asks for, appending the ones the
// head does not have yet, then hands back the callback that makes the head
// exactly the destination's set. Add first, drop last: dropping first flashes
// the page unstyled. Throwing on a failed load lets the caller fall back to a
// real navigation: a full page load renders correctly, the destination under
// the origin's stylesheet does not. Returns null when this navigation has been
// superseded, which means it must touch nothing at all.
async function syncStylesheets(doc, url, ownsHead) {
  const wanted = stylesheetLinks(doc).map((link) => new URL(link.getAttribute('href'), url).href)
  // This check and the appends below are one synchronous run, so no other
  // navigation can slip between them. That is what makes "anything this
  // navigation appended was appended before any newer navigation's cleanup"
  // true, and therefore what guarantees the winner sweeps up after the losers.
  if (!ownsHead()) return null
  const appended = []
  const loads = wanted.map((href) => {
    const live = stylesheetLinks(document).find((link) => link.href === href)
    const known = stylesheetLoads.get(href)
    // A link the document itself shipped with is already applied and has no
    // load to wait for; one this router appended does.
    if (live) return known?.link === live ? known.load : Promise.resolve('load')
    const entry = appendStylesheet(href)
    appended.push(entry)
    return entry.load
  })
  const outcomes = await Promise.all(loads)
  if (!ownsHead()) return null
  if (outcomes.includes('error')) {
    for (const entry of appended) removeStylesheet(entry.link)
    throw new Error(`stylesheet failed to load for ${url.pathname}`)
  }
  return () => {
    if (!ownsHead()) return
    for (const link of stylesheetLinks(document)) {
      if (!wanted.includes(link.href)) removeStylesheet(link)
    }
    // Belt and braces: whatever happened while this navigation was in flight,
    // the head it commits is exactly the destination's set.
    for (const href of wanted) {
      if (!stylesheetLinks(document).some((link) => link.href === href)) appendStylesheet(href)
    }
  }
}

// Resolves false when this navigation was superseded before it could commit:
// the newer one owns the page, and this one must leave the DOM and the head
// exactly as it found them.
async function swapPage(html, url, ownsHead) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const commitStylesheets = await syncStylesheets(doc, url, ownsHead)
  if (!commitStylesheets) return false
  // From here to commitStylesheets() there is no await, so the swap and the
  // head reconciliation are atomic against any other navigation.
  cleanupPage()
  const newMain = doc.querySelector('.layout .content')
  const currentMain = document.querySelector('.layout .content')
  if (newMain && currentMain) {
    // doc -> doc: keep header + sidebar alive so focus and scroll state survive.
    currentMain.replaceWith(newMain)
    document.querySelector('.layout .aside').replaceWith(doc.querySelector('.layout .aside'))
    for (const link of document.querySelectorAll('.sidebar a')) {
      if (new URL(link.href).pathname === url.pathname) link.setAttribute('aria-current', 'page')
      else link.removeAttribute('aria-current')
    }
  } else {
    // home <-> doc: structures differ, swap the whole routed region.
    document
      .querySelector('div.layout, main.home')
      .replaceWith(doc.querySelector('div.layout, main.home'))
  }
  document.title = doc.title
  document.body.className = doc.body.className
  commitStylesheets()
  setSidebarOpen(false)
  initPage()
  const announcer = document.getElementById('route-announcer')
  if (announcer) announcer.textContent = doc.title
  if (url.hash) {
    document.getElementById(decodeURIComponent(url.hash.slice(1)))?.scrollIntoView()
  } else {
    window.scrollTo(0, 0)
  }
  // Only move focus if the previously focused element was swapped away.
  if (!document.activeElement || document.activeElement === document.body) {
    const main = document.getElementById('main-content')
    main.tabIndex = -1
    main.focus({ preventScroll: true })
  }
  return true
}

if ('navigation' in window) {
  navigation.addEventListener('navigate', (event) => {
    if (!event.canIntercept || event.hashChange || event.downloadRequest !== null) return
    const url = new URL(event.destination.url)
    if (url.origin !== location.origin) return
    // Pages are extensionless routes (or "/", or a direct .html file); anything
    // with another file extension is an asset the router must not intercept.
    const lastSegment = url.pathname.split('/').at(-1) ?? ''
    if (lastSegment.includes('.') && !lastSegment.endsWith('.html')) return
    // Claimed here rather than inside the handler: the navigate events arrive in
    // navigation order, so the ticket order is the browser's order and not the
    // order in which the handlers happen to be scheduled.
    const ownsHead = claimNavigation(event.signal)
    event.intercept({
      scroll: 'manual',
      focusReset: 'manual',
      async handler() {
        try {
          const html = await fetchPage(url.href)
          if (!ownsHead()) return
          await swapPage(html, url, ownsHead)
        } catch {
          // A superseded navigation must not drag the page anywhere: the one
          // that replaced it is already rendering, and a location.assign here
          // would throw the reader back to the destination they left.
          if (!ownsHead()) return
          location.assign(url.href) // fall back to a full navigation
        }
      },
    })
  })

  // Warm the cache when a nav/sidebar link is hovered or touched.
  document.addEventListener('pointerover', (event) => {
    const link = event.target.closest('.sidebar a, .top-nav a, .pager a, .hero-actions a')
    if (link && new URL(link.href).origin === location.origin) {
      afterFirstLoad(() => fetchPage(link.href).catch(() => {}))
    }
  })
}

// ---------- search (persistent chrome) ----------
const searchButton = document.getElementById('search-button')
const searchDialog = document.getElementById('search-dialog')
const searchInput = document.getElementById('search-input')
const searchResults = document.getElementById('search-results')
const searchStatus = document.getElementById('search-status')
const searchClose = document.getElementById('search-close')

let searchEngine = null
let searchReady = null
let selectedIndex = -1

function loadSearch() {
  searchReady ??= (async () => {
    const [{ default: MiniSearch }, response] = await Promise.all([
      import(new URL('./minisearch/index.js', import.meta.url)),
      fetch(new URL('../search-index.json', import.meta.url)),
    ])
    const documents = await response.json()
    searchEngine = new MiniSearch({
      fields: ['title', 'text', 'page'],
      storeFields: ['title', 'text', 'page', 'group', 'href'],
      searchOptions: {
        boost: { title: 3, page: 2 },
        prefix: true,
        fuzzy: 0.15,
      },
    })
    searchEngine.addAll(documents)
  })()
  return searchReady
}

function openSearch() {
  searchDialog.showModal()
  searchInput.value = ''
  renderResults([])
  searchStatus.textContent = 'Type to search the documentation.'
  searchInput.focus()
  loadSearch().catch(() => {
    searchStatus.textContent = 'Search is unavailable.'
  })
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const escapeHtml = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

function highlightTerms(text, terms) {
  let html = escapeHtml(text)
  for (const term of terms) {
    if (term.length < 2) continue
    html = html.replace(new RegExp(`(${escapeRegExp(escapeHtml(term))})`, 'gi'), '<mark>$1</mark>')
  }
  return html
}

function renderResults(results, terms = []) {
  searchResults.innerHTML = ''
  selectedIndex = -1
  searchInput.setAttribute('aria-expanded', String(results.length > 0))
  searchInput.removeAttribute('aria-activedescendant')
  results.forEach((result, index) => {
    const item = document.createElement('li')
    item.setAttribute('role', 'presentation')
    const snippet = result.text ? result.text.slice(0, 160) : ''
    item.innerHTML =
      `<a href="${result.href}" id="search-result-${index}" role="option" aria-selected="false">` +
      `<span class="search-result-page">${escapeHtml(result.group)} › ${escapeHtml(result.page)}</span>` +
      `<span class="search-result-title">${highlightTerms(result.title, terms)}</span>` +
      (snippet ? `<span class="search-result-text">${highlightTerms(snippet, terms)}</span>` : '') +
      '</a>'
    item.addEventListener('mousemove', () => select(index))
    item.querySelector('a').addEventListener('click', () => searchDialog.close())
    searchResults.appendChild(item)
  })
}

const optionElements = () => searchResults.querySelectorAll('[role="option"]')

function select(index) {
  const options = optionElements()
  if (options.length === 0) return
  if (selectedIndex >= 0) options[selectedIndex]?.setAttribute('aria-selected', 'false')
  selectedIndex = (index + options.length) % options.length
  const option = options[selectedIndex]
  option.setAttribute('aria-selected', 'true')
  option.scrollIntoView({ block: 'nearest' })
  searchInput.setAttribute('aria-activedescendant', option.id)
}

searchInput.addEventListener('input', async () => {
  const query = searchInput.value.trim()
  if (!query) {
    renderResults([])
    searchStatus.textContent = 'Type to search the documentation.'
    return
  }
  await loadSearch()
  const results = searchEngine.search(query).slice(0, 12)
  renderResults(results, query.split(/\s+/))
  searchStatus.textContent = results.length
    ? `${results.length} result${results.length === 1 ? '' : 's'}`
    : `No results for “${query}”`
})

searchInput.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    select(selectedIndex + 1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    select(selectedIndex - 1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const link = optionElements()[Math.max(selectedIndex, 0)]
    if (link) link.click()
  }
})

searchButton.addEventListener('click', openSearch)
searchClose.addEventListener('click', () => searchDialog.close())
searchDialog.addEventListener('click', (event) => {
  if (event.target === searchDialog) searchDialog.close()
})
// A non-empty type=search input swallows Escape to clear itself; always close instead.
searchDialog.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault()
    searchDialog.close()
  }
})

window.addEventListener('keydown', (event) => {
  const editing =
    /^(input|textarea|select)$/i.test(document.activeElement?.tagName ?? '') ||
    document.activeElement?.isContentEditable
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    searchDialog.open ? searchDialog.close() : openSearch()
  } else if (event.key === '/' && !editing && !searchDialog.open) {
    event.preventDefault()
    openSearch()
  }
})
