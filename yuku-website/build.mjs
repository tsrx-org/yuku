// Builds yuku.tsrx.dev: Markdown in this folder to HTML in dist/. Run: node build.mjs
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse } from '@tsrx/yuku'
import { Marked } from 'marked'
import { build as rolldownBuild } from 'rolldown'
import { examples, heroCode } from './demo-sources.mjs'
import { getDocsHighlighter, highlightWith } from './highlight.mjs'
import config from './site.config.mjs'

const docsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(docsDir, '..')
const outDir = path.join(docsDir, 'dist')
const yukuDir = path.join(docsDir, 'node_modules', '@tsrx', 'yuku')
const yukuVersion = JSON.parse(await readFile(path.join(yukuDir, 'package.json'), 'utf8')).version
const REDIRECTS = config.redirects ?? {}

function followRedirect(href) {
  const hash = href.indexOf('#')
  const route = hash === -1 ? href : href.slice(0, hash)
  const destination = REDIRECTS[route]
  return destination ? destination + (hash === -1 ? '' : href.slice(hash)) : href
}

const escapeHtml = (text) =>
  String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const namedEntities = { amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"' }

function decodeEntities(text) {
  return text.replace(/&(#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi, (match, name) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1))
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match
    }
    return namedEntities[name.toLowerCase()] ?? match
  })
}

function slugify(text) {
  return decodeEntities(text.replace(/<[^>]*>/g, ''))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-')
}

function makeSlugger() {
  const seen = new Map()
  return (text) => {
    const slug = slugify(text) || 'section'
    const count = seen.get(slug) ?? 0
    seen.set(slug, count + 1)
    return count === 0 ? slug : `${slug}-${count}`
  }
}

function parseFrontmatter(source) {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(source)
  if (!match) return { data: {}, body: source }
  const data = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator > 0) data[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return { data, body: source.slice(match[0].length) }
}

// ---------- benchmark data, read from the repository ----------

// bench/chart.svg, written by `bun run bench`: one label and one time per parser.
async function readSuiteBenchmark() {
  const svg = await readFile(path.join(repoRoot, 'bench', 'chart.svg'), 'utf8')
  const names = [...svg.matchAll(/<text (?![^>]*class="ratio")[^>]*text-anchor="end">([^<]+)<\/text>/g)].map((m) => m[1])
  const times = [...svg.matchAll(/<text [^>]*>([\d.]+) µs<\/text>/g)].map((m) => Number(m[1]))
  if (names.length !== 2 || times.length !== 2) throw new Error('bench/chart.svg: expected two parsers')
  const lanes = names.map((name, index) => ({ name, microseconds: times[index] }))
  const yuku = lanes.find((lane) => lane.name === '@tsrx/yuku')
  const core = lanes.find((lane) => lane.name === '@tsrx/core')
  if (!yuku || !core) throw new Error('bench/chart.svg: expected @tsrx/yuku and @tsrx/core')
  const ratio = /class="ratio"[^>]*>([\d.]+)×</.exec(svg)
  if (!ratio) throw new Error('bench/chart.svg: no ratio')
  return { yuku, core, speedup: Number(ratio[1]) }
}

// The tsrx.dev pages table in the README.
async function readPagesBenchmark() {
  const readme = await readFile(path.join(repoRoot, 'README.md'), 'utf8')
  const lines = readme.split('\n')
  const start = lines.findIndex((line) => line.startsWith('| page |'))
  if (start === -1) throw new Error('README.md: no tsrx.dev pages table')
  const header = lines[start].split('|').slice(1, -1).map((cell) => cell.trim())
  const rows = []
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim())
    rows.push({
      page: cells[0],
      values: cells.slice(1).map((cell) => (/^[\d.]+$/.test(cell) ? Number(cell) : cell || null)),
    })
  }
  const total = rows.find((row) => row.page === 'total')
  const pages = rows.filter((row) => row !== total)
  const sum = (column, list = pages) => list.reduce((acc, row) => acc + row.values[column], 0)
  for (const column of [0, 1]) {
    if (Math.abs(sum(column) - total.values[column]) > 0.002) {
      throw new Error(`README.md: the ${header[column + 1]} total is not the sum of its pages`)
    }
  }
  const pagesSpeedup = total.values[1] / total.values[0]
  const pagesClaim = `${pagesSpeedup.toFixed(1)}x faster than \`@tsrx/core\``
  if (!readme.includes(pagesClaim)) throw new Error(`README.md: expected "${pagesClaim}" from the pages table`)
  return { header, pages, total, pagesSpeedup }
}

const suite = await readSuiteBenchmark()
const pagesBench = await readPagesBenchmark()
const countTsrx = async (kind) =>
  (await readdir(path.join(repoRoot, 'test', 'suite', kind))).filter((file) => file.endsWith('.tsrx')).length
const suiteFiles = await countTsrx('pass')
const suiteFailing = await countTsrx('fail')
const facts = {
  version: yukuVersion,
  suiteSpeedup: suite.speedup.toFixed(1),
  suiteYuku: `${suite.yuku.microseconds} µs`,
  suiteCore: `${suite.core.microseconds} µs`,
  suiteFiles: suiteFiles.toLocaleString('en-US'),
  suiteFailing: suiteFailing.toLocaleString('en-US'),
  suiteTotal: (suiteFiles + suiteFailing).toLocaleString('en-US'),
  pagesSpeedup: pagesBench.pagesSpeedup.toFixed(1),
  pagesYuku: `${pagesBench.total.values[0]} ms`,
  pagesCore: `${pagesBench.total.values[1]} ms`,
}
const fillFacts = (text) =>
  text.replace(/\{\{(\w+)\}\}/g, (match, name) => {
    if (!(name in facts)) throw new Error(`unknown fact {{${name}}}`)
    return facts[name]
  })

function pagesTableMarkdown() {
  const { header, pages, total } = pagesBench
  const cell = (value) => (value === null ? '' : typeof value === 'number' ? value.toFixed(3) : value)
  return [
    `| ${header.join(' | ')} |`,
    `| --- |${header.slice(1).map(() => ' ---: |').join('')}`,
    ...[...pages, total].map((row) => `| ${row.page} | ${row.values.map(cell).join(' | ')} |`),
  ].join('\n')
}

// ---------- highlighting, assets ----------

const highlighter = await getDocsHighlighter()
const highlightHtml = (code, lang) => highlightWith(highlighter, code, lang)

const styleSource = await readFile(path.join(docsDir, 'assets', 'style.css'), 'utf8')

// Every asset is served from /assets/<hash of all assets>/, cached as immutable, so a page
// can only ever load the files of its own build. build() sets the hash before any page renders.
let assetHash = null
const asset = (file) => {
  if (assetHash === null) throw new Error(`asset(${file}) before the assets were hashed`)
  return `/assets/${assetHash}/${file}`
}

const CSS_SHELLS = ['doc', 'home', 'playground']

// Regions of style.css between `#css-pages:` and `#css-pages-end` ship only to the shells they name.
function splitStylesheet(source) {
  const bundles = new Map(CSS_SHELLS.map((shell) => [shell, []]))
  let shells = null
  for (const [index, line] of source.split('\n').entries()) {
    const opening = /^[ \t]*\/\* #css-pages:([a-z ]+)\*\/[ \t]*$/.exec(line)
    if (opening) {
      if (shells) throw new Error(`style.css:${index + 1}: #css-pages region opened inside another`)
      shells = opening[1].trim().split(/\s+/)
      continue
    }
    if (/^[ \t]*\/\* #css-pages-end \*\/[ \t]*$/.test(line)) {
      if (!shells) throw new Error(`style.css:${index + 1}: #css-pages-end closes nothing`)
      shells = null
      continue
    }
    for (const shell of CSS_SHELLS) {
      if (!shells || shells.includes(shell)) bundles.get(shell).push(line)
    }
  }
  if (shells) throw new Error('style.css: a #css-pages region is never closed')
  return bundles
}

const TSRX_DOCS = {
  '@{': ['Code block', 'Statements, then the one node the block renders.'],
  '@if': ['Conditional', 'Renders when the condition is truthy.'],
  '@else': ['Fallback', 'Renders when @if fails; chain with @else if.'],
  '@for': ['Loop', 'Renders once per item. Supports index i and key expr.'],
  '@empty': ['Loop fallback', 'Renders when the loop has nothing to show.'],
  '@switch': ['Match', 'Picks the @case that matches a value.'],
  '@case': ['Branch', 'Written as @case value: { … }.'],
  '@default': ['Fallback', 'Renders when no @case matches.'],
  '@try': ['Async boundary', 'Awaited content, with loading and error branches.'],
  '@pending': ['Loading', 'Shown while @try content loads.'],
  '@catch': ['Error', 'Handles @try failures; (error, reset) supported.'],
}

function addTsrxHovers(html) {
  html = html.replace(
    /(<span style="([^"]*)">)([ \t]*)@else<\/span><span style="\2">([ \t]*if\b)/g,
    (match, open, style, whitespace, ifWord) =>
      `${open}${whitespace}<span class="tsrx-hover" tabindex="0" role="img" aria-label="@else if: Chained conditional. Tests another condition when the previous branch failed." data-doc-title="@else if · Chained conditional" data-doc="Tests another condition when the previous branch failed.">@else${ifWord}</span>`,
  )
  return html.replace(
    /(<span(?! class="tsrx-hover")[^>]*>)([ \t]*)(@(?:\{|if|else|for|empty|switch|case|default|try|pending|catch))(<\/span>)/g,
    (match, open, whitespace, token, close) => {
      const doc = TSRX_DOCS[token]
      if (!doc) return match
      return `${open}${whitespace}<span class="tsrx-hover" tabindex="0" role="img" aria-label="${escapeHtml(
        `${token}: ${doc[0]}. ${doc[1]}`,
      )}" data-doc-title="${escapeHtml(`${token} · ${doc[0]}`)}" data-doc="${escapeHtml(doc[1])}">${token}</span>${close}`
    },
  )
}

// ---------- fences: every tsrx fence is parsed, and must parse as it says ----------

// ```tsrx parses clean; ```tsrx error=TSRX2011 must report that code first; no-playground skips both.
function checkTsrxFence(text, flags, where) {
  if (flags.includes('no-playground')) return
  const expected = flags.find((flag) => flag.startsWith('error='))?.slice('error='.length)
  const { diagnostics } = parse(text, { path: 'example.tsrx' })
  if (expected) {
    if (!diagnostics[0]?.message.startsWith(`${expected}:`)) {
      throw new Error(`${where}: a fence marked error=${expected} reported ${diagnostics[0]?.message ?? 'nothing'}`)
    }
  } else if (diagnostics.length > 0) {
    throw new Error(`${where}: a tsrx fence does not parse: ${diagnostics[0].message}\n${text}`)
  }
}

function createMarked(slugger, headings, where) {
  const marked = new Marked()
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        const id = slugger(html)
        const text = decodeEntities(html.replace(/<[^>]*>/g, ''))
        headings.push({ depth, id, text })
        const anchor =
          depth > 1 ? `<a class="header-anchor" href="#${id}" aria-label="Permalink to “${escapeHtml(text)}”">#</a>` : ''
        return `<h${depth} id="${id}">${html}${anchor}</h${depth}>\n`
      },
      code({ text, lang }) {
        const [language, ...flags] = (lang || 'text').split(/\s+/)
        if (language === 'tsrx') checkTsrxFence(text, flags, where)
        const tryButton =
          language === 'tsrx' && !flags.includes('no-playground')
            ? `<button type="button" class="try-button" data-code="${escapeHtml(text)}">Try in playground</button>`
            : ''
        let body = highlightHtml(text, language)
        if (language === 'tsrx') body = addTsrxHovers(body)
        return `<div class="code-block" data-lang="${escapeHtml(language)}">${body}${tryButton}</div>\n`
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens)
        if (/^https?:\/\//.test(href)) {
          const brand = /^brand:([a-z][a-z-]*)$/.exec(title ?? '')?.[1]
          const mark = brand ? brandIconHtml(brand) : ''
          return `<a${mark ? ' class="brand-link"' : ''} href="${href}" target="_blank" rel="noreferrer">${mark}${text}<span class="visually-hidden"> (opens in new tab)</span></a>`
        }
        return `<a href="${followRedirect(href.replace(/\.md(?=$|#)/, ''))}">${text}</a>`
      },
    },
  })
  return marked
}

function extractSections(marked, body, page) {
  const slugger = makeSlugger()
  const sections = []
  let current = { title: page.title, anchor: '', parts: [] }
  const flush = () => {
    const text = current.parts.join(' ').replace(/\s+/g, ' ').trim()
    if (text || current.anchor) sections.push({ ...current, text })
  }
  const plain = (raw) =>
    raw
      .replace(/```[^\n]*\n?/g, ' ')
      .replace(/[`*_#>|]/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]*>/g, ' ')
  for (const token of marked.lexer(body)) {
    if (token.type === 'heading' && token.depth <= 3) {
      const id = slugger(token.text)
      if (token.depth === 1) {
        current.title = token.text
        continue
      }
      flush()
      current = { title: token.text, anchor: id, parts: [] }
    } else if (token.raw) {
      current.parts.push(plain(token.raw))
    }
  }
  flush()
  return sections.map((section, index) => ({
    id: `${page.link}#${index}`,
    page: page.title,
    group: page.group,
    title: section.title,
    href: page.link + (section.anchor ? `#${section.anchor}` : ''),
    text: section.text.slice(0, 1200),
  }))
}

// ---------- page chrome ----------

const githubIcon =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18a11 11 0 0 1 2.88-.39c.98 0 1.96.13 2.88.39 2.19-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14 0 1.54-.02 2.79-.02 3.17 0 .31.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>'
const navHtml = config.nav
  .map((item) =>
    item.link.startsWith('https://github.com')
      ? `<li><a class="nav-github" href="${item.link}" aria-label="${item.text} repository" title="${item.text}">${githubIcon}</a></li>`
      : `<li><a href="${item.link}">${item.text}</a></li>`,
  )
  .join('')

function sidebarHtml(activeLink) {
  return config.sidebar
    .map(
      (group) => `
      <section class="sidebar-group">
        <h2 class="sidebar-group-title">${group.text}</h2>
        <ul>
          ${group.items
            .map(
              (item) =>
                `<li><a href="${item.link}"${item.link === activeLink ? ' aria-current="page"' : ''}>${item.text}</a></li>`,
            )
            .join('\n')}
        </ul>
      </section>`,
    )
    .join('\n')
}

const WORDS_PER_MINUTE = 200

function annotateReadingTime(articleHtml, headings) {
  const marks = [...articleHtml.matchAll(/<h([23]) id="([^"]+)"/g)]
  const words = (html) =>
    html
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;|&#\d+;/gi, ' ')
      .split(/\s+/)
      .filter(Boolean).length
  const counted = new Map()
  for (const [index, mark] of marks.entries()) {
    const end = index + 1 < marks.length ? marks[index + 1].index : articleHtml.length
    counted.set(mark[2], words(articleHtml.slice(mark.index, end)))
  }
  const lead = marks.length > 0 ? words(articleHtml.slice(0, marks[0].index)) : words(articleHtml)
  for (const heading of headings) heading.words = counted.get(heading.id) ?? 0
  return lead
}

function outlineHtml(headings, leadWords = 0) {
  const items = headings.filter((h) => h.depth === 2 || h.depth === 3)
  if (items.length === 0) return ''
  const total = Math.max(1, Math.round((leadWords + items.reduce((sum, h) => sum + (h.words ?? 0), 0)) / WORDS_PER_MINUTE))
  return `
    <nav class="outline" aria-labelledby="outline-title">
      <p class="outline-title" id="outline-title">On this page</p>
      <div class="outline-progress" data-total-minutes="${total}">
        <div class="outline-progress-track" aria-hidden="true"><div class="outline-progress-fill"></div></div>
        <p class="outline-remaining" aria-live="polite">${total} min read</p>
      </div>
      <ul>
        ${items.map((h) => `<li class="outline-depth-${h.depth}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`).join('\n')}
      </ul>
    </nav>`
}

function prevNextHtml(pageIndex, flat) {
  const prev = flat[pageIndex - 1]
  const next = flat[pageIndex + 1]
  if (!prev && !next) return ''
  const cell = (item, kind, label) =>
    item
      ? `<div class="pager-link ${kind}"><a href="${item.link}"><span class="pager-label">${label}</span><span class="pager-title">${item.text}</span></a></div>`
      : '<div></div>'
  return `<nav class="pager" aria-label="Previous and next page">
    ${cell(prev, 'prev', 'Previous page')}
    ${cell(next, 'next', 'Next page')}
  </nav>`
}

const themeInit = `(() => {
  try {
    const stored = localStorage.getItem('yuku-tsrx-theme')
    const dark = stored ? stored === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches
    document.documentElement.classList.toggle('dark', dark)
  } catch {}
})()`


const canonicalUrl = (pathname) => `${config.origin}${pathname}`

const searchDialog = `
<dialog id="search-dialog" class="search-dialog" aria-label="Search documentation">
  <div class="search-panel">
    <form class="search-form" role="search" onsubmit="return false">
      <label class="visually-hidden" for="search-input">Search documentation</label>
      <input id="search-input" type="search" role="combobox" aria-expanded="false"
        aria-controls="search-results" aria-autocomplete="list" autocomplete="off"
        placeholder="Search docs" />
      <button type="button" class="search-close" id="search-close">Esc</button>
    </form>
    <ul id="search-results" class="search-results" role="listbox" aria-label="Search results"></ul>
    <p id="search-status" class="search-status" role="status"></p>
  </div>
</dialog>`

function headerHtml() {
  return `
<header class="navbar">
  <div class="navbar-inner">
    <button id="menu-toggle" class="menu-toggle" aria-label="Navigation menu" aria-expanded="false" aria-controls="sidebar">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>
    <a class="site-title" href="/"><img class="site-logo" src="${asset('logo.svg')}" alt="" width="26" height="26" />${config.title}</a>
    <div class="navbar-spacer"></div>
    <button id="search-button" class="search-button" aria-label="Search documentation">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <span class="search-button-text">Search</span>
      <kbd class="search-key" aria-hidden="true">⌘K</kbd>
    </button>
    <nav class="top-nav" aria-label="Main navigation"><ul>${navHtml}</ul></nav>
    <button id="theme-toggle" class="theme-toggle" aria-label="Toggle dark theme" aria-pressed="false">
      <svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>
      <svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/></svg>
    </button>
  </div>
</header>`
}

function pageShell({ title, description, pathname, shell, bodyClass, main }) {
  const fullTitle = title === config.title ? title : `${title} | ${config.title}`
  const summary = description || config.description
  const canonical = canonicalUrl(pathname)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(fullTitle)}</title>
<meta name="description" content="${escapeHtml(summary)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${escapeHtml(config.title)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:title" content="${escapeHtml(fullTitle)}" />
<meta property="og:description" content="${escapeHtml(summary)}" />
<meta property="og:image" content="${config.origin}${asset('social-card.png')}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${escapeHtml(config.title)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(fullTitle)}" />
<meta name="twitter:description" content="${escapeHtml(summary)}" />
<meta name="twitter:image" content="${config.origin}${asset('social-card.png')}" />
<meta name="color-scheme" content="light dark" />
<link rel="icon" href="${asset('logo.svg')}" />
<link rel="preload" href="${asset('fonts/space-grotesk-latin.woff2')}" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="${asset('fonts/inter-latin.woff2')}" as="font" type="font/woff2" crossorigin />
<script>${themeInit}</script>
<link rel="stylesheet" href="${asset(`style-${shell}.css`)}" />
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main-content">Skip to content</a>
${headerHtml()}
${main}
${searchDialog}
<div id="route-announcer" class="visually-hidden" aria-live="polite"></div>
<script type="module" src="${asset('app.js')}"></script>
</body>
</html>
`
}

const DISCLOSURE_PATTERN = /<!-- details:([\s\S]*?) -->([\s\S]*?)<!-- \/details -->/g

const disclosureHtml = (article) =>
  article.replace(
    DISCLOSURE_PATTERN,
    (_match, summary, body) =>
      `<details class="disclosure"><summary>${escapeHtml(summary.trim())}</summary>\n${body.trim()}\n</details>\n`,
  )

const disclosureMarkdown = (body) =>
  body.replace(DISCLOSURE_PATTERN, (_match, summary, inner) => `**${summary.trim()}**\n${inner.trim()}\n`)

// ---------- package-manager tabs and brand marks ----------

const PM_INSTALL_VARIANTS = [
  { npm: 'npm install --save-dev', pnpm: 'pnpm add -D', yarn: 'yarn add -D', bun: 'bun add -d', deno: 'deno add -D npm:' },
  { npm: 'npm install', pnpm: 'pnpm add', yarn: 'yarn add', bun: 'bun add', deno: 'deno add npm:' },
]
const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'deno']
const PM_TABS_PATTERN = /<!-- pm-install -->\r?\n```sh\r?\n([\s\S]*?)\r?\n```/g

// Simple Icons (CC0) single-path marks.
const BRAND_ICONS = {
  npm: 'M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z',
  pnpm: 'M0 0v7.5h7.5V0zm8.25 0v7.5h7.498V0zm8.25 0v7.5H24V0zM2 2h3.5v3.5H2zm8.25 0h3.498v3.5H10.25zm8.25 0H22v3.5h-3.5zM8.25 8.25v7.5h7.498v-7.5zm8.25 0v7.5H24v-7.5zm2 2H22v3.5h-3.5zM0 16.5V24h7.5v-7.5zm8.25 0V24h7.498v-7.5zm8.25 0V24H24v-7.5z',
  yarn: 'M12 0C5.375 0 0 5.375 0 12s5.375 12 12 12 12-5.375 12-12S18.625 0 12 0zm.768 4.105c.183 0 .363.053.525.157.125.083.287.185.755 1.154.31-.088.468-.042.551-.019.204.056.366.19.463.375.477.917.542 2.553.334 3.605-.241 1.232-.755 2.029-1.131 2.576.324.329.778.899 1.117 1.825.278.774.31 1.478.273 2.015a5.51 5.51 0 0 0 .602-.329c.593-.366 1.487-.917 2.553-.931.714-.009 1.269.445 1.353 1.103a1.23 1.23 0 0 1-.945 1.362c-.649.158-.95.278-1.821.843-1.232.797-2.539 1.242-3.012 1.39a1.686 1.686 0 0 1-.704.343c-.737.181-3.266.315-3.466.315h-.046c-.783 0-1.214-.241-1.45-.491-.658.329-1.51.19-2.122-.134a1.078 1.078 0 0 1-.58-1.153 1.243 1.243 0 0 1-.153-.195c-.162-.25-.528-.936-.454-1.946.056-.723.556-1.367.88-1.71a5.522 5.522 0 0 1 .408-2.256c.306-.727.885-1.348 1.32-1.737-.32-.537-.644-1.367-.329-2.21.227-.602.412-.936.82-1.08h-.005c.199-.074.389-.153.486-.259a3.418 3.418 0 0 1 2.298-1.103c.037-.093.079-.185.125-.283.31-.658.639-1.029 1.024-1.168a.94.94 0 0 1 .328-.06zm.006.7c-.507.016-1.001 1.519-1.001 1.519s-1.27-.204-2.266.871c-.199.218-.468.334-.746.44-.079.028-.176.023-.417.672-.371.991.625 2.094.625 2.094s-1.186.839-1.626 1.881c-.486 1.144-.338 2.261-.338 2.261s-.843.732-.899 1.487c-.051.663.139 1.2.343 1.515.227.343.51.176.51.176s-.561.653-.037.931c.477.25 1.283.394 1.71-.037.31-.31.371-1.001.486-1.283.028-.065.12.111.209.199.097.093.264.195.264.195s-.755.324-.445 1.066c.102.246.468.403 1.066.398.222-.005 2.664-.139 3.313-.296.375-.088.505-.283.505-.283s1.566-.431 2.998-1.357c.917-.598 1.293-.76 2.034-.936.612-.148.57-1.098-.241-1.084-.839.009-1.575.44-2.196.825-1.163.718-1.742.672-1.742.672l-.018-.032c-.079-.13.371-1.293-.134-2.678-.547-1.515-1.413-1.881-1.344-1.997.297-.5 1.038-1.297 1.334-2.78.176-.899.13-2.377-.269-3.151-.074-.144-.732.241-.732.241s-.616-1.371-.788-1.483a.271.271 0 0 0-.157-.046z',
  bun: 'M12 22.596c6.628 0 12-4.338 12-9.688 0-3.318-2.057-6.248-5.219-7.986-1.286-.715-2.297-1.357-3.139-1.89C14.058 2.025 13.08 1.404 12 1.404c-1.097 0-2.334.785-3.966 1.821a49.92 49.92 0 0 1-2.816 1.697C2.057 6.66 0 9.59 0 12.908c0 5.35 5.372 9.687 12 9.687v.001ZM10.599 4.715c.334-.759.503-1.58.498-2.409 0-.145.202-.187.23-.029.658 2.783-.902 4.162-2.057 4.624-.124.048-.199-.121-.103-.209a5.763 5.763 0 0 0 1.432-1.977Zm2.058-.102a5.82 5.82 0 0 0-.782-2.306v-.016c-.069-.123.086-.263.185-.172 1.962 2.111 1.307 4.067.556 5.051-.082.103-.23-.003-.189-.126a5.85 5.85 0 0 0 .23-2.431Zm1.776-.561a5.727 5.727 0 0 0-1.612-1.806v-.014c-.112-.085-.024-.274.114-.218 2.595 1.087 2.774 3.18 2.459 4.407a.116.116 0 0 1-.049.071.11.11 0 0 1-.153-.026.122.122 0 0 1-.022-.083 5.891 5.891 0 0 0-.737-2.331Zm-5.087.561c-.617.546-1.282.76-2.063 1-.117 0-.195-.078-.156-.181 1.752-.909 2.376-1.649 2.999-2.778 0 0 .155-.118.188.085 0 .304-.349 1.329-.968 1.874Zm4.945 11.237a2.957 2.957 0 0 1-.937 1.553c-.346.346-.8.565-1.286.62a2.178 2.178 0 0 1-1.327-.62 2.955 2.955 0 0 1-.925-1.553.244.244 0 0 1 .064-.198.234.234 0 0 1 .193-.069h3.965a.226.226 0 0 1 .19.07c.05.053.073.125.063.197Zm-5.458-2.176a1.862 1.862 0 0 1-2.384-.245 1.98 1.98 0 0 1-.233-2.447c.207-.319.503-.566.848-.713a1.84 1.84 0 0 1 1.092-.11c.366.075.703.261.967.531a1.98 1.98 0 0 1 .408 2.114 1.931 1.931 0 0 1-.698.869v.001Zm8.495.005a1.86 1.86 0 0 1-2.381-.253 1.964 1.964 0 0 1-.547-1.366c0-.384.11-.76.32-1.079.207-.319.503-.567.849-.713a1.844 1.844 0 0 1 1.093-.108c.367.076.704.262.968.534a1.98 1.98 0 0 1 .4 2.117 1.932 1.932 0 0 1-.702.868Z',
  deno: 'M1.105 18.02A11.9 11.9 0 0 1 0 12.985q0-.698.078-1.376a12 12 0 0 1 .231-1.34A12 12 0 0 1 4.025 4.02a12 12 0 0 1 5.46-2.771 12 12 0 0 1 3.428-.23c1.452.112 2.825.477 4.077 1.05a12 12 0 0 1 2.78 1.774 12.02 12.02 0 0 1 4.053 7.078A12 12 0 0 1 24 12.985q0 .454-.036.914a12 12 0 0 1-.728 3.305 12 12 0 0 1-2.38 3.875c-1.33 1.357-3.02 1.962-4.43 1.936a4.4 4.4 0 0 1-2.724-1.024c-.99-.853-1.391-1.83-1.53-2.919a5 5 0 0 1 .128-1.518c.105-.38.37-1.116.76-1.437-.455-.197-1.04-.624-1.226-.829-.045-.05-.04-.13 0-.183a.155.155 0 0 1 .177-.053c.392.134.869.267 1.372.35.66.111 1.484.25 2.317.292 2.03.1 4.153-.813 4.812-2.627s.403-3.609-1.96-4.685-3.454-2.356-5.363-3.128c-1.247-.505-2.636-.205-4.06.582-3.838 2.121-7.277 8.822-5.69 15.032a.191.191 0 0 1-.315.19 12 12 0 0 1-1.25-1.634 12 12 0 0 1-.769-1.404M11.57 6.087c.649-.051 1.214.501 1.31 1.236.13.979-.228 1.99-1.41 2.013-1.01.02-1.315-.997-1.248-1.614.066-.616.574-1.575 1.35-1.635',
}

const BRAND_IMAGES = { tsrx: 'brands/tsrx.svg', '@tsrx/yuku': 'logo.svg' }

function brandIconHtml(name) {
  const image = BRAND_IMAGES[name]
  if (image) return `<img src="${asset(image)}" alt="" width="16" height="16" loading="lazy">`
  const d = BRAND_ICONS[name]
  return d ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${d}"/></svg>` : ''
}

function translateShellLine(line, pm) {
  const variant = PM_INSTALL_VARIANTS.find((entry) => line.startsWith(entry.npm))
  if (!variant) return line
  const rest = line.slice(variant.npm.length)
  return pm === 'deno' ? `${variant.deno}${rest.trim()}` : `${variant[pm]}${rest}`
}

function pmInstallTabsHtml(npmCommand, groupId) {
  const lines = npmCommand.split('\n')
  const buttons = PACKAGE_MANAGERS.map(
    (pm, index) =>
      `<button type="button" role="tab" id="pm-tab-${groupId}-${pm}" aria-controls="pm-panel-${groupId}-${pm}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-pm="${pm}">${brandIconHtml(pm)}${pm}</button>`,
  ).join('')
  const panels = PACKAGE_MANAGERS.map((pm, index) => {
    const command = lines.map((line) => translateShellLine(line, pm)).join('\n')
    return `<div role="tabpanel" id="pm-panel-${groupId}-${pm}" aria-labelledby="pm-tab-${groupId}-${pm}" data-pm="${pm}"${index === 0 ? '' : ' hidden'}><div class="code-block" data-lang="sh">${highlightHtml(command, 'sh')}</div></div>`
  }).join('')
  return `<div class="pm-tabs" data-pm-tabs><div class="pm-tabs-bar" role="tablist" aria-label="Package manager">${buttons}</div>${panels}</div>\n`
}

function pageMenuHtml(link) {
  const mdHref = `${link}.md`
  const prompt = encodeURIComponent(
    `Read ${config.origin}${mdHref} so I can ask questions about this ${config.title} documentation page.`,
  )
  return `<div class="page-menu" data-page-menu>
      <button type="button" class="copy-md-button page-menu-main" data-md-href="${mdHref}">Copy page</button>
      <button type="button" class="page-menu-toggle" aria-haspopup="menu" aria-expanded="false" aria-label="More ways to use this page">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <ul class="page-menu-list" role="menu" hidden>
        <li role="none"><button type="button" role="menuitem" class="copy-md-button" data-md-href="${mdHref}">Copy page as Markdown</button></li>
        <li role="none"><a role="menuitem" href="${mdHref}" target="_blank" rel="noreferrer">View as plain Markdown</a></li>
        <li role="none"><a role="menuitem" href="https://chatgpt.com/?hints=search&q=${prompt}" target="_blank" rel="noreferrer">Open in ChatGPT</a></li>
        <li role="none"><a role="menuitem" href="https://claude.ai/new?q=${prompt}" target="_blank" rel="noreferrer">Open in Claude</a></li>
      </ul>
    </div>`
}

const footerHtml = () => `<footer class="site-footer">
  <p>Maintained by <a href="https://github.com/thejackshelton" target="_blank" rel="noreferrer">Jack Shelton</a>. Thanks to <a href="https://github.com/arshad-yaseen" target="_blank" rel="noreferrer">Arshad Yaseen</a> for his help. MIT licensed, on <a href="${config.repository}" target="_blank" rel="noreferrer">GitHub</a>.</p>
</footer>`

function renderDocPage({ page, article, headings, pageIndex, flat, leadWords }) {
  const main = `
<div class="layout">
  <div id="sidebar-backdrop" class="sidebar-backdrop" hidden></div>
  <aside id="sidebar" class="sidebar" aria-label="Sidebar">
    <nav aria-label="Docs navigation">
      ${sidebarHtml(page.link)}
    </nav>
  </aside>
  <main id="main-content" class="content">
    <div class="doc-toolbar">${pageMenuHtml(page.link)}</div>
    <article class="doc">
      ${article}
    </article>
    ${prevNextHtml(pageIndex, flat)}
    ${footerHtml()}
  </main>
  <aside class="aside" aria-label="Page outline">${outlineHtml(headings, leadWords)}</aside>
</div>`
  return pageShell({ title: page.title, description: page.description, pathname: page.link, shell: 'doc', bodyClass: 'doc-page', main })
}

// ---------- generated blocks inside pages ----------

const astSource = await readFile(path.join(repoRoot, 'src', 'ast.ts'), 'utf8')
const tsrxTypes = astSource.slice(astSource.indexOf('/** What a template renders. */')).replace(/^export /gm, '').trim()

const BLOCKS = {
  'tsrx-types': {
    html: () => null,
    markdown: () => `\`\`\`ts\n${tsrxTypes}\n\`\`\``,
  },
  'pages-table': {
    html: () => null,
    markdown: pagesTableMarkdown,
  },
  'suite-chart': {
    html: () =>
      `<figure class="bench-figure"><img src="${asset('bench/chart.svg')}" alt="Time per file to parse the ${facts.suiteFiles} sources of the test suite: @tsrx/yuku ${facts.suiteYuku}, @tsrx/core ${facts.suiteCore}, ${suite.speedup}x as long" width="640" height="52"></figure>`,
    markdown: () =>
      `![Time per file to parse the test suite: @tsrx/yuku ${facts.suiteYuku}, @tsrx/core ${facts.suiteCore}](${config.origin}${asset('bench/chart.svg')})`,
  },
}
const BLOCK_PATTERN = /<!-- block:([a-z-]+) -->/g

function expandBlocksMarkdown(body) {
  return body.replace(BLOCK_PATTERN, (match, name) => {
    const block = BLOCKS[name]
    if (!block) throw new Error(`unknown block ${name}`)
    return block.markdown()
  })
}

function expandBlocksHtml(body) {
  return body.replace(BLOCK_PATTERN, (match, name) => BLOCKS[name].html() ?? BLOCKS[name].markdown())
}

// ---------- home and playground ----------

const escapeDataset = (text) => escapeHtml(escapeHtml(text))

function homeBenchCards() {
  const cards = [
    {
      value: `${facts.suiteSpeedup}&times;`,
      label: 'faster than @tsrx/core on the test suite',
      budget: `${facts.suiteYuku} against ${facts.suiteCore} per file`,
      note: `Median time per file over the ${facts.suiteFiles} TSRX sources of the test suite, from bench/chart.svg.`,
    },
    {
      value: `${facts.pagesSpeedup}&times;`,
      label: 'faster than @tsrx/core on the pages of tsrx.dev',
      budget: `${facts.pagesYuku} against ${facts.pagesCore} for all ${pagesBench.pages.length} pages`,
      note: 'The total of the tsrx.dev pages table in the README, 319 kB of TSRX.',
    },
    {
      value: facts.suiteTotal,
      label: 'TSRX sources in the test suite',
      budget: 'each parses, or fails, as in @tsrx/core, unless that accepts invalid TypeScript',
      note: `Every TSRX source of the TSRX repository and of the tests of @tsrx/core: ${facts.suiteFiles} that parse and ${facts.suiteFailing} that fail, as @tsrx/core parses them, except where it accepts what TypeScript rejects.`,
    },
  ]
  return `<div class="gate-grid" role="group" aria-label="Headline figures from the benchmarks in the repository">${cards
    .map(
      (card) => `
  <div class="bench-row gate-card" role="img" aria-label="${escapeHtml(`${card.value.replace('&times;', 'x')} ${card.label}, ${card.budget}`)}"
     data-label="${escapeDataset(card.value.replace('&times;', '×'))}" data-result="${escapeDataset(card.label)}" data-note="${escapeDataset(card.note)}">
    <span class="gate-value">${card.value}</span>
    <span class="gate-label">${escapeHtml(card.label)}</span>
    <span class="gate-budget">${escapeHtml(card.budget)}</span>
  </div>`,
    )
    .join('')}</div>`
}

function homeCompChart() {
  const lanes = [
    { key: 'yukuTsrx', ...suite.yuku, ours: true, note: 'The published @tsrx/yuku, building an ESTree AST.' },
    { key: 'tsrxCore', ...suite.core, ours: false, note: 'The official TSRX parser, building an ESTree AST from the same sources.' },
  ]
  const slowest = Math.max(...lanes.map((lane) => lane.microseconds))
  const rows = lanes
    .map((lane) => {
      const widthPct = Math.max((lane.microseconds / slowest) * 100, 0.8)
      const label = `${lane.microseconds} µs`
      return `
  <div class="bench-row comp-row${lane.ours ? ' comp-ours' : ''}" tabindex="0" role="img" aria-label="${escapeHtml(`${lane.name}: ${label} per file`)}"
     data-key="${lane.key}" data-label="${escapeDataset(lane.name)}" data-result="${escapeDataset(`${label} per file`)}"
     data-note="${escapeDataset(lane.note)}">
    <span class="comp-head"><span class="comp-name">${escapeHtml(lane.name)}</span><span class="comp-time">${escapeHtml(label)}</span></span>
    <span class="comp-track"><span class="bench-bar comp-fill" style="width:${widthPct.toFixed(1)}%"></span></span>
  </div>`
    })
    .join('')
  return `<div class="comp-chart" role="group" aria-label="Median time per file to parse the test suite. Shorter bars are faster.">${rows}
</div>
<p class="home-bench-caption">Shorter is faster. Median time per file to parse the ${facts.suiteFiles} TSRX sources of the test suite, over 3 runs, each in a fresh Node.js 24 process on an Apple M5 Pro.</p>`
}

const PLAYGROUND_ROUTE = config.playground
const PLAYGROUND_IDLE_NOTE = 'Pick an example, or type your own TSRX. Everything below is computed in this tab.'

function outputPanelHtml() {
  const tabs = [
    ['ast', 'AST', 'The program parse returns, as JSON: ESTree, with TSRX nodes such as JSXCodeBlock, JSXForExpression and JSXStyleElement.'],
    ['diagnostics', 'Diagnostics', 'Every diagnostic, with the TSRXnnnn code @tsrx/core reports. The parse also reports semantic errors here.'],
    ['generated', 'Generated code', 'The program printed back to TSRX by generate.'],
    ['semantic', 'Semantic', 'The scopes, bindings, references, imports, and exports analyze finds.'],
  ]
  return `<div class="code-panel pg-output" id="pg-output" data-explorer>
        <div class="code-panel-bar pg-output-tabs" role="tablist" aria-label="Parser output">
          <span class="pg-pane-label" aria-hidden="true">Output</span>
          ${tabs
            .map(
              ([id, label], index) =>
                `<button type="button" role="tab" id="pg-tab-${id}" aria-controls="pg-panel-${id}" aria-selected="${index === 0}"${index === 0 ? '' : ' tabindex="-1"'}>${label}</button>`,
            )
            .join('\n          ')}
        </div>
        <div class="pg-output-body">
          ${tabs
            .map(
              ([id, label, note], index) =>
                `<div role="tabpanel" id="pg-panel-${id}" aria-labelledby="pg-tab-${id}"${index === 0 ? '' : ' hidden'}><p class="pg-note pg-output-note">${note}</p><div class="pg-output-code" id="pg-${id}"></div></div>`,
            )
            .join('\n          ')}
        </div>
        <div class="code-panel-status"><span id="pg-output-status">the parser starts when this page loads</span></div>
      </div>`
}

function editorPanelHtml(file, actions) {
  return `<div class="code-panel pg-panel" id="hero-demo" data-path="${escapeHtml(file)}">
        <div class="code-panel-bar">
          <span class="code-panel-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="code-panel-file">${escapeHtml(file)}</span>
          <span class="code-panel-hint" id="demo-hint"></span>
          <span class="code-panel-actions" id="demo-actions" hidden>${actions}</span>
        </div>
        <div class="code-panel-editor" id="demo-editor">
          ${addTsrxHovers(highlightHtml(heroCode, 'tsrx'))}
        </div>
        <div class="code-panel-status">
          <span id="demo-status" aria-live="polite">a TSRX component, highlighted with the TSRX grammar</span>
          <span id="demo-meta">@tsrx/yuku</span>
        </div>
      </div>`
}

function checkExamples() {
  for (const example of [{ id: 'hero', source: heroCode }, ...examples]) {
    const { diagnostics } = parse(example.source, { path: 'playground.tsrx', semanticErrors: true })
    const first = diagnostics[0]?.message
    if (example.error ? !first?.startsWith(`${example.error}:`) : first !== undefined) {
      throw new Error(`demo-sources.mjs: ${example.id} expected ${example.error ?? 'no diagnostics'}, got ${first ?? 'none'}`)
    }
  }
}

function renderPlaygroundPage() {
  const buttons = examples
    .map(
      (example) =>
        `<button type="button" class="demo-button" id="pg-scenario-${example.id}" data-scenario="${example.id}">${escapeHtml(example.label)}</button>`,
    )
    .join('\n          ')
  const entries = Object.fromEntries(examples.map((example) => [example.id, { source: example.source, note: example.note }]))
  const main = `
<main id="main-content" class="home playground-page">
  <section class="pg" aria-label="Playground">
    <header class="pg-topbar">
      <h1 class="pg-title">TSRX Playground</h1>
      <p class="pg-tagline">The published @tsrx/yuku, running in this tab: parse, analyze, generate.</p>
    </header>
    <div class="pg-toolbar pg-examples-bar" id="pg-side">
      <div class="pg-examples" role="group" aria-label="Examples">
        <span class="pg-examples-label" id="pg-engine-label">Examples</span>
        ${buttons}
      </div>
      <p class="pg-note" id="pg-scenario-note" role="status" data-idle="${escapeHtml(PLAYGROUND_IDLE_NOTE)}">${escapeHtml(PLAYGROUND_IDLE_NOTE)}</p>
    </div>
    <div class="pg-panes">
      ${editorPanelHtml('playground.tsrx', `
            <button type="button" class="demo-button" id="demo-share">Share</button>
            <button type="button" class="demo-button" id="demo-reset">Reset</button>`)}
      ${outputPanelHtml()}
    </div>
  </section>
  <script type="application/json" id="pg-fixtures">${JSON.stringify(entries).replaceAll('<', '\\u003c')}</script>
</main>`
  return pageShell({
    title: 'Playground',
    description: 'Edit TSRX and watch @tsrx/yuku parse, analyze, and print it in your browser.',
    pathname: PLAYGROUND_ROUTE,
    shell: 'playground',
    bodyClass: 'home-page',
    main,
  })
}

function renderHomePage({ description }) {
  const hero = config.hero
  const main = `
<main id="main-content" class="home">
  <section class="hero">
    <img class="hero-logo" src="${asset('logo.svg')}" alt="" width="64" height="64" />
    <h1 class="hero-name">${hero.name}</h1>
    <p class="hero-text">${hero.text}</p>
    <p class="hero-tagline">${hero.tagline}</p>
    <div class="hero-actions">
      ${hero.actions.map((action) => `<a class="action action-${action.theme}" href="${action.link}">${action.text}</a>`).join('\n')}
    </div>
  </section>
  <section class="band" aria-label="TSRX example">
    <div class="pg-panes hero-panes">
    ${editorPanelHtml('src/Cart.tsrx', `
          <button type="button" class="demo-button" id="demo-reset">Reset</button>
          <button type="button" class="demo-button" id="demo-open">Open in playground</button>`)}
    ${outputPanelHtml()}
    </div>
  </section>
  <section class="home-bench" aria-label="Measured parse time">
    <h2>Parsing performance</h2>
    <p>Against the official parser, <code>@tsrx/core</code>, both building an ESTree AST.</p>
    ${homeBenchCards()}
    ${homeCompChart()}
    <p class="home-bench-link"><a href="/reference/benchmarks">The benchmarks, and how to run them</a></p>
  </section>
  <section class="features" aria-label="Feature highlights">
    <ul class="features-grid">
      ${config.features
        .map(
          (feature) => `
      <li class="feature">
        <span class="feature-icon">${feature.icon}</span>
        <h2 class="feature-title">${feature.title}</h2>
        <p class="feature-details">${fillFacts(feature.details)}</p>
      </li>`,
        )
        .join('\n')}
    </ul>
  </section>
  <section class="home-credit" aria-label="Credits">
    <p>Maintained by <a href="https://github.com/thejackshelton" target="_blank" rel="noreferrer">Jack Shelton</a>, on <a href="${config.repository}" target="_blank" rel="noreferrer">tsrx-org/yuku</a>. Thanks to <a href="https://github.com/arshad-yaseen" target="_blank" rel="noreferrer">Arshad Yaseen</a> for his help.</p>
    <p class="home-next"><strong>Next:</strong> a CSS tree for every <code>&lt;style&gt;</code>, parsed in the same pass by <a href="https://github.com/thejackshelton/yuku-css" target="_blank" rel="noreferrer">yuku-css</a>, once <a href="https://github.com/yuku-toolchain/yuku/pull/280" target="_blank" rel="noreferrer">yuku#280</a> lands.</p>
  </section>
  <footer class="home-footer">
    <p class="footer-links"><a href="${config.repository}" target="_blank" rel="noreferrer">GitHub<span class="visually-hidden"> (opens in new tab)</span></a> · <a href="https://www.npmjs.com/package/@tsrx/yuku" target="_blank" rel="noreferrer">npm<span class="visually-hidden"> (opens in new tab)</span></a> · <a href="https://yuku.fyi" target="_blank" rel="noreferrer">yuku.fyi<span class="visually-hidden"> (opens in new tab)</span></a> · <a href="https://tsrx.dev" target="_blank" rel="noreferrer">tsrx.dev<span class="visually-hidden"> (opens in new tab)</span></a></p>
  </footer>
</main>`
  return pageShell({ title: config.title, description, pathname: '/', shell: 'home', bodyClass: 'home-page', main })
}

// ---------- the browser build of @tsrx/yuku ----------

// The playground runs the published package. Its WebAssembly is fetched as a file,
// as workerd loads it, instead of inlined, and Yuku's own module is left out, since
// @tsrx/yuku always passes its own.
const wasmModulePlugin = {
  name: 'tsrx-yuku-wasm-file',
  resolveId(id, importer) {
    if (id !== '#module' || !importer) return null
    if (importer.includes(`${path.sep}@tsrx${path.sep}yuku${path.sep}`)) return '\0tsrx-module'
    if (importer.includes(`${path.sep}yuku${path.sep}`)) return '\0yuku-module'
    return null
  },
  load(id) {
    if (id === '\0yuku-module') return 'export const yuku = undefined'
    if (id !== '\0tsrx-module') return null
    return `const url = new URL('./yuku-tsrx.wasm', import.meta.url)
const response = await fetch(url)
if (!response.ok) throw new Error('@tsrx/yuku: HTTP ' + response.status + ' for ' + url.pathname)
export const tsrx = (response.headers.get('content-type') ?? '').includes('application/wasm')
  ? await WebAssembly.compileStreaming(response)
  : await WebAssembly.compile(await response.arrayBuffer())`
  },
}

async function bundleBrowserAssets(assetsOut) {
  await rolldownBuild({
    input: path.join(docsDir, 'yuku-tsrx-entry.mjs'),
    platform: 'browser',
    plugins: [wasmModulePlugin],
    output: { format: 'esm', file: path.join(assetsOut, 'yuku-tsrx.js'), minify: true },
  })
  await cp(path.join(yukuDir, 'dist', 'yuku-tsrx.wasm'), path.join(assetsOut, 'yuku-tsrx.wasm'))
  await rolldownBuild({
    input: path.join(docsDir, 'demo-highlighter-entry.mjs'),
    platform: 'browser',
    output: { format: 'esm', file: path.join(assetsOut, 'demo-highlighter.js'), minify: true },
  })
}

// ---------- assets ----------

async function writeAssets() {
  const staging = path.join(outDir, 'assets', 'staging')
  await cp(path.join(docsDir, 'assets'), staging, { recursive: true })
  await mkdir(path.join(staging, 'bench'), { recursive: true })
  await cp(path.join(repoRoot, 'bench', 'chart.svg'), path.join(staging, 'bench', 'chart.svg'))
  await bundleBrowserAssets(staging)
  await rm(path.join(staging, 'style.css'))
  for (const [shell, lines] of splitStylesheet(styleSource)) {
    await writeFile(
      path.join(staging, `style-${shell}.css`),
      lines.join('\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n'),
    )
  }
  await cp(path.join(docsDir, 'node_modules', 'minisearch', 'dist', 'es'), path.join(staging, 'minisearch'), { recursive: true })
  const hash = createHash('sha256')
  for (const file of (await readdir(staging, { recursive: true })).sort()) {
    const full = path.join(staging, file)
    if ((await stat(full)).isFile()) hash.update(file).update(await readFile(full))
  }
  const digest = hash.digest('hex').slice(0, 12)
  await rename(staging, path.join(outDir, 'assets', digest))
  return digest
}

// Fails on any /assets/ URL in the output that isn't in this build's hashed directory.
async function checkAssetReferences() {
  const unhashed = []
  for (const file of await readdir(outDir, { recursive: true })) {
    if (!/\.(html|md|txt|xml|json|css|js)$/.test(file)) continue
    const text = await readFile(path.join(outDir, file), 'utf8')
    for (const [reference] of text.matchAll(/\/assets\/[^"'`)\s<>]+/g)) {
      const [pathname] = reference.split(/[?#]/)
      if (!pathname.startsWith(`/assets/${assetHash}/`) || !existsSync(path.join(outDir, pathname))) {
        unhashed.push(`${file}: ${reference}`)
      }
    }
  }
  if (unhashed.length > 0) throw new Error(`asset URLs outside /assets/${assetHash}/:\n${unhashed.join('\n')}`)
}

// ---------- build ----------

async function build() {
  checkExamples()
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })

  const flat = config.sidebar.flatMap((group) => group.items.map((item) => ({ ...item, group: group.text })))
  const pages = flat.filter((item, index) => flat.findIndex((other) => other.link === item.link) === index)
  const claimed = new Set(pages.map((page) => path.join(docsDir, `${page.link.slice(1)}.md`)))
  for (const section of new Set(pages.map((page) => page.link.split('/')[1]))) {
    for (const file of await readdir(path.join(docsDir, section))) {
      const sourcePath = path.join(docsDir, section, file)
      if (file.endsWith('.md') && !claimed.has(sourcePath)) throw new Error(`a page missing from the sidebar: ${section}/${file}`)
    }
  }

  assetHash = await writeAssets()

  const searchDocs = []
  const markdownPages = []
  for (const [pageIndex, item] of pages.entries()) {
    const where = `${item.link.slice(1)}.md`
    const { data, body: ownBody } = parseFrontmatter(await readFile(path.join(docsDir, where), 'utf8'))
    // `include: ../docs/x.md` publishes a document of the repository as this page
    const rawBody = data.include ? await readFile(path.join(docsDir, data.include), 'utf8') : ownBody
    const sourceBody = fillFacts(rawBody)
    if (/\u2014/.test(sourceBody)) throw new Error(`${where}: no em dashes`)
    const pmBlocks = []
    const body = expandBlocksHtml(sourceBody).replace(PM_TABS_PATTERN, (_match, command) => {
      pmBlocks.push(command)
      return `<!-- pm-tabs:${pmBlocks.length - 1} -->`
    })
    let exportedBody = disclosureMarkdown(expandBlocksMarkdown(sourceBody).replace(/<!-- pm-install -->\r?\n/g, ''))
    const page = { link: item.link, group: item.group, title: data.title || item.text, description: data.description || '' }
    const headings = []
    let article = createMarked(makeSlugger(), headings, where)
      .parse(body)
      .replaceAll('<table>', '<div class="table-wrap"><table>')
      .replaceAll('</table>', '</table></div>')
      .replace(/<th([^>]*)>\s*<\/th>/g, '<td$1></td>')
    article = disclosureHtml(article)
    for (const [index, command] of pmBlocks.entries()) {
      article = article.replace(`<!-- pm-tabs:${index} -->`, pmInstallTabsHtml(command, index))
    }
    searchDocs.push(...extractSections(new Marked(), exportedBody, page))
    const leadWords = annotateReadingTime(article, headings)
    const outPath = path.join(outDir, `${item.link.slice(1)}.html`)
    await mkdir(path.dirname(outPath), { recursive: true })
    await writeFile(outPath, renderDocPage({ page, article, headings, leadWords, pageIndex, flat: pages }))
    await writeFile(outPath.replace(/\.html$/, '.md'), exportedBody)
    markdownPages.push({ ...page, body: exportedBody })
  }

  await writeFile(
    path.join(outDir, 'llms.txt'),
    [
      `# ${config.title}`,
      '',
      `> ${config.description}`,
      '',
      ...config.sidebar.map((group) =>
        [
          `## ${group.text}`,
          '',
          ...group.items.map((item) => {
            const page = markdownPages.find((candidate) => candidate.link === item.link)
            return `- [${item.text}](${item.link}.md)${page?.description ? `: ${page.description}` : ''}`
          }),
          '',
        ].join('\n'),
      ),
    ].join('\n'),
  )
  await writeFile(
    path.join(outDir, 'llms-full.txt'),
    markdownPages.map((page) => `<!-- ${page.group} / ${page.title} (${page.link}) -->\n\n${page.body}`).join('\n\n---\n\n'),
  )

  const home = parseFrontmatter(await readFile(path.join(docsDir, 'index.md'), 'utf8'))
  const homeHtml = renderHomePage({ description: home.data.description })
  const playgroundHtml = renderPlaygroundPage()
  for (const [name, html] of [['index', homeHtml], [PLAYGROUND_ROUTE.slice(1), playgroundHtml]]) {
    if (/\u2014/.test(html.replace(/<pre[\s\S]*?<\/pre>/g, ''))) throw new Error(`${name}: no em dashes`)
    await writeFile(path.join(outDir, `${name}.html`), html)
  }

  await writeFile(path.join(outDir, 'search-index.json'), JSON.stringify(searchDocs))
  await checkAssetReferences()

  const publicPaths = ['/', PLAYGROUND_ROUTE, ...pages.map(({ link }) => link)]
  const expectedRedirects = Object.entries(REDIRECTS).flatMap(([from, to]) => {
    if (!publicPaths.includes(to)) throw new Error(`site.config.mjs redirects ${from} to ${to}, which is not a page`)
    if (publicPaths.includes(from)) throw new Error(`site.config.mjs redirects ${from}, which is a page`)
    return [
      { source: from, destination: to, permanent: true },
      { source: `${from}.md`, destination: `${to}.md`, permanent: true },
    ]
  })
  const vercel = JSON.parse(await readFile(path.join(docsDir, 'vercel.json'), 'utf8'))
  if (JSON.stringify(vercel.redirects) !== JSON.stringify(expectedRedirects)) {
    throw new Error(
      `vercel.json redirects differ from site.config.mjs; set them to:\n${JSON.stringify(expectedRedirects, null, 2)}`,
    )
  }

  await writeFile(path.join(outDir, 'robots.txt'), `User-agent: *\nAllow: /\nSitemap: ${canonicalUrl('/sitemap.xml')}\n`)
  await writeFile(
    path.join(outDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicPaths
      .map((pathname) => `  <url><loc>${canonicalUrl(pathname)}</loc></url>`)
      .join('\n')}\n</urlset>\n`,
  )
  console.log(`built ${publicPaths.length} pages and ${searchDocs.length} search sections with @tsrx/yuku ${yukuVersion} -> ${outDir}`)
}

await build()
