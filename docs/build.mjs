// Static docs site generator: markdown in docs/ -> HTML in docs/dist/.
// Plain JavaScript, no framework. Run with: node docs/build.mjs
import { createHash } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Marked } from 'marked'
import { build as rolldownBuild } from 'rolldown'
import { getDocsHighlighter, highlightWith } from './highlight.mjs'
import config from './site.config.mjs'
import { heroCode } from './demo-sources.mjs'
import { createNodeEngine } from './wasm-node.mjs'
import { readStamp, srcTree, stampPathFor } from '../tools/wasm-stamp.mjs'

const docsDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(docsDir, '..')
const defaultOutDir = path.join(docsDir, 'dist')
const outDir = process.env.YUKU_TSRX_DOCS_OUT_DIR
  ? path.resolve(process.env.YUKU_TSRX_DOCS_OUT_DIR)
  : defaultOutDir
const base = config.base ?? '/'
const trimmedBase = base.replace(/\/$/, '')
// Site pages live under the base path inside the deploy root, so the domain
// root stays free for the landing page and deploy-wide files (vercel.json,
// robots.txt).
const siteDir = trimmedBase
  ? path.join(outDir, ...trimmedBase.split('/').filter(Boolean))
  : outDir

const withBase = (href) => {
  if (!href.startsWith('/')) return href
  if (href === '/') return trimmedBase || '/'
  return trimmedBase + href
}

// A retired route in a page link lands on its replacement directly rather than
// on a redirect hop; the map is the same one vercel.json is written from.
const REDIRECTS = config.redirects ?? {}

// A build for a legacy location (config.redirectTo set) sends its base path and
// everything under it, permanently, to the same path on the canonical origin.
// Only the base path is claimed. `--redirect-only` writes nothing but that: the
// artifact for a Vercel project whose only remaining job is to redirect.
const redirectOnly = process.argv.includes('--redirect-only')
if (redirectOnly && !config.redirectTo) {
  throw new Error('--redirect-only needs a legacy SITE_ORIGIN; the canonical build redirects nothing')
}
const legacyRedirects = () =>
  config.redirectTo
    ? [
        { source: trimmedBase || '/', destination: `${config.redirectTo}/`, permanent: true },
        { source: `${trimmedBase}/:path*`, destination: `${config.redirectTo}/:path*`, permanent: true },
      ]
    : []
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

function isSameOrAncestor(candidate, target) {
  const relative = path.relative(candidate, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

async function resolveThroughExistingAncestor(candidate) {
  let existing = candidate
  for (;;) {
    try {
      const canonical = await realpath(existing)
      return path.resolve(canonical, path.relative(existing, candidate))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const parent = path.dirname(existing)
      if (parent === existing) throw error
      existing = parent
    }
  }
}

async function validateOutputDirectory() {
  if (
    outDir === path.parse(outDir).root ||
    isSameOrAncestor(outDir, repoRoot) ||
    outDir === docsDir
  ) {
    throw new Error(`refusing destructive docs output directory: ${outDir}`)
  }
  let metadata = null
  try {
    metadata = await lstat(outDir)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  if (metadata?.isSymbolicLink()) throw new Error(`refusing symlink docs output directory: ${outDir}`)
  if (outDir === defaultOutDir) return

  const tempRoot = path.resolve(tmpdir())
  const relative = path.relative(tempRoot, outDir)
  if (
    relative.startsWith('..') ||
    path.isAbsolute(relative) ||
    !path.basename(outDir).startsWith('yuku-tsrx-')
  ) {
    throw new Error(`custom docs output must be a yuku-tsrx-* directory under ${tempRoot}`)
  }
  const canonicalTempRoot = await realpath(tempRoot)
  const canonicalOutDir = await resolveThroughExistingAncestor(outDir)
  const expectedCanonicalOutDir = path.resolve(canonicalTempRoot, relative)
  const canonicalRelative = path.relative(canonicalTempRoot, canonicalOutDir)
  if (
    canonicalOutDir !== expectedCanonicalOutDir ||
    canonicalRelative.startsWith('..') ||
    path.isAbsolute(canonicalRelative)
  ) {
    throw new Error(
      `custom docs output resolves outside the trusted temporary directory: ${outDir}`,
    )
  }
  if (metadata && !metadata.isDirectory()) throw new Error(`docs output is not a directory: ${outDir}`)
  if (metadata && (await readdir(outDir)).length > 0) {
    throw new Error(`refusing nonempty custom docs output directory: ${outDir}`)
  }
}

const namedEntities = {
  amp: '&',
  apos: "'",
  gt: '>',
  lt: '<',
  nbsp: ' ',
  quot: '"',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
}

// Headings are slugged from rendered inline HTML, so a heading that quotes a
// phrase arrives as `&quot;…&quot;`. Stripping punctuation without decoding first
// leaves the entity *name* in the id, which is how
// `What "a plain install" actually covers` became
// `what-quota-plain-installquot-actually-covers` and broke every link to it.
// Tags go first: decoding `&lt;` before that would manufacture one.
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
    if (separator > 0) {
      data[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
    }
  }
  return { data, body: source.slice(match[0].length) }
}

const highlighter = await getDocsHighlighter()
const highlightHtml = (code, lang) => highlightWith(highlighter, code, lang)

// Content hash of the shared chrome assets, appended as ?v= to their URLs so
// deployed pages never pair fresh HTML with a stale cached stylesheet.
const styleSource = await readFile(path.join(docsDir, 'assets', 'style.css'), 'utf8')
const assetVersionHash = createHash('sha256').update(styleSource)
const scriptAssets = (await readdir(path.join(docsDir, 'assets'), { recursive: true }))
  .filter((entry) => entry.endsWith('.js') || entry.endsWith('.mjs'))
  .map((entry) => entry.split(path.sep).join('/'))
  .sort()
for (const entry of scriptAssets) {
  assetVersionHash.update(entry).update(await readFile(path.join(docsDir, 'assets', entry)))
}
assetVersionHash
  .update('demo-highlighter-entry.mjs')
  .update(await readFile(path.join(docsDir, 'demo-highlighter-entry.mjs')))
const assetVersion = assetVersionHash.digest('hex').slice(0, 10)

// The three page shells this site renders. Each one gets its own stylesheet.
const CSS_SHELLS = ['doc', 'home', 'playground']

// docs/assets/style.css is authored as one file but most of it can only ever
// match one shell, so shipping all of it to every page made the home page carry
// the sidebar, the article typography and every doc component it never renders.
// Regions marked `#css-pages:` are kept only for the shells they name (see the
// header comment in the stylesheet); everything else is shared chrome. Lines
// keep their authored order in every bundle, so a shell's cascade is exactly the
// cascade of the source file with the other shells' rules deleted.
function splitStylesheet(source) {
  const bundles = new Map(CSS_SHELLS.map((shell) => [shell, []]))
  let shells = null
  let openedAt = 0
  const lines = source.split('\n')
  for (const [index, line] of lines.entries()) {
    const opening = /^[ \t]*\/\* #css-pages:([a-z ]+)\*\/[ \t]*$/.exec(line)
    if (opening) {
      if (shells) {
        throw new Error(
          `style.css:${index + 1}: #css-pages region opened inside the one opened on line ${openedAt}`,
        )
      }
      shells = opening[1].trim().split(/\s+/)
      openedAt = index + 1
      const unknown = shells.filter((shell) => shell !== 'none' && !CSS_SHELLS.includes(shell))
      if (unknown.length > 0) {
        throw new Error(
          `style.css:${index + 1}: unknown page shell ${unknown.join(', ')} (expected ${CSS_SHELLS.join(', ')} or none)`,
        )
      }
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
  if (shells) throw new Error(`style.css:${openedAt}: #css-pages region is never closed`)
  return bundles
}

const styleBundles = splitStylesheet(styleSource)

// Editor-style hover docs for TSRX constructs in code examples, mirroring the
// quick-info experience of the Markless VS Code extension.
const TSRX_DOCS = {
  '@{': [
    'Statement container',
    'A statement container that allows you to have statements and markup colocated.',
  ],
  '@if': ['Conditional', 'Renders when the condition is truthy.'],
  '@else': ['Fallback', 'Runs when @if fails; chain with @else if.'],
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
  // Chained form first. The grammar scopes the trailing `if` as part of the
  // directive, so shiki emits two adjacent spans with identical styling; fuse
  // them so the hover target is the whole `@else if` rather than half of it.
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

// Site-wide hover glossary: first prose occurrence of each technical term on
// a page gets an editor-style tooltip, so jargon is explained where it sits.
const GLOSSARY = {
  p95: ['p95', '95 of 100 runs were at least this fast. A worst-realistic-case number, not an average.'],
  throughput: ['throughput', 'How much source code is processed per second. Higher is better.'],
  'MiB/s': ['MiB/s', 'Mebibytes of source code processed per second.'],
  'fail-closed': ['fail-closed', 'Unsupported input produces a clear error instead of a silently wrong result.'],
}

function addGlossary(article) {
  const seen = new Set()
  const wrapText = (text) => {
    let out = text
    for (const [term, [title, doc]] of Object.entries(GLOSSARY)) {
      if (seen.has(term)) continue
      const pattern = new RegExp(`(^|[\\s(])(${term.replace('/', '\\/').replace('-', '\\-')})(?=[\\s.,;:)]|$)`)
      if (!pattern.test(out)) continue
      seen.add(term)
      out = out.replace(
        pattern,
        (m, pre, word) =>
          `${pre}<span class="tsrx-hover" tabindex="0" role="img" aria-label="${escapeHtml(`${title}: ${doc}`)}" data-doc-title="${escapeHtml(title)}" data-doc="${escapeHtml(doc)}">${word}</span>`,
      )
    }
    return out
  }
  return article.replace(/(<(?:p|li)>)([\s\S]*?)(<\/(?:p|li)>)/g, (match, open, body, close) => {
    const parts = body.split(/(<[^>]+>)/)
    for (let i = 0; i < parts.length; i += 2) parts[i] = wrapText(parts[i])
    return open + parts.join('') + close
  })
}

function createMarked(slugger, headings, nodeChips = null) {
  const marked = new Marked()
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const html = this.parser.parseInline(tokens)
        const id = slugger(html)
        // Plain text, not inline HTML: the outline and the permalink label both
        // escape what they are given, so an undecoded `&quot;` would be escaped
        // a second time and read as `&quot;` on the page.
        const text = decodeEntities(html.replace(/<[^>]*>/g, ''))
        headings.push({ depth, id, text })
        const anchor =
          depth > 1
            ? `<a class="header-anchor" href="#${id}" aria-label="Permalink to “${escapeHtml(
                text,
              )}”">#</a>`
            : ''
        return `<h${depth} id="${id}">${html}${anchor}</h${depth}>\n`
      },
      code({ text, lang }) {
        const [language, ...flags] = (lang || 'text').split(/\s+/)
        // The button hands the fence to the real parser in the reader's tab, so
        // it is only honest on a fence the parser accepts. A sample that is not
        // a whole file, or that shows what invalid TSRX looks like, opts out
        // with ```tsrx no-playground; `node tools/wasm-smoke.mjs --fences`
        // proves every fence that keeps the button still parses clean.
        const tryButton =
          language === 'tsrx' && !flags.includes('no-playground')
            ? `<button type="button" class="try-button" data-code="${escapeHtml(text)}">Try in playground</button>`
            : ''
        let body = highlightHtml(text, language)
        if (language === 'tsrx') body = addTsrxHovers(body)
        // On a page carrying the node-chips marker, every tsrx fence was handed
        // to the parser before this renderer ran. A fence with no entry means
        // the two disagree about what the fences are, which is a build failure
        // rather than a fence that quietly loses its chips.
        let chips = ''
        if (nodeChips && language === 'tsrx') {
          const entry = nodeChips.get(text)
          if (!entry) throw new Error(`node chips: no parse for a tsrx fence starting ${text.split('\n')[0]}`)
          chips = nodeChipsHtml(entry)
        }
        return `<div class="code-block" data-lang="${escapeHtml(language)}">${body}${tryButton}</div>\n${chips}`
      },
      link({ href, title, tokens }) {
        const text = this.parser.parseInline(tokens)
        if (/^https?:\/\//.test(href)) {
          // `[Deno](https://deno.com "brand:deno")` renders the project's own
          // mark next to its name. The title is the only inline signal Markdown
          // gives an author, and an unknown brand degrades to a plain link.
          const brand = /^brand:([a-z][a-z-]*)$/.exec(title ?? '')?.[1]
          const mark = brand ? brandIconHtml(brand) : ''
          return `<a${mark ? ' class="brand-link"' : ''} href="${href}" target="_blank" rel="noreferrer">${mark}${text}<span class="visually-hidden"> (opens in new tab)</span></a>`
        }
        // A source link may name the file (`./yuku-dialect.md#…`) the way it
        // reads in an editor. The site serves routes, not files, so drop the
        // extension rather than shipping a link that lands on nothing.
        return `<a href="${withBase(followRedirect(href.replace(/\.md(?=$|#)/, '')))}">${text}</a>`
      },
    },
  })
  return marked
}

// Collect page text per heading section for the client-side search index.
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
    href: withBase(page.link) + (section.anchor ? `#${section.anchor}` : ''),
    text: section.text.slice(0, 1200),
  }))
}

const githubIcon =
  '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.55 0-.28-.01-1.02-.02-2-3.2.7-3.87-1.54-3.87-1.54-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.18 1.76 1.18 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.73-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.18-3.09-.12-.29-.51-1.46.11-3.04 0 0 .96-.31 3.16 1.18a11 11 0 0 1 2.88-.39c.98 0 1.96.13 2.88.39 2.19-1.49 3.16-1.18 3.16-1.18.62 1.58.23 2.75.11 3.04.74.81 1.18 1.83 1.18 3.09 0 4.42-2.69 5.39-5.25 5.67.41.36.78 1.06.78 2.14 0 1.54-.02 2.79-.02 3.17 0 .31.21.67.8.55A11.51 11.51 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>'
const navHtml = config.nav
  .map((item) =>
    item.link.startsWith('https://github.com')
      ? `<li><a class="nav-github" href="${item.link}" aria-label="${item.text} repository" title="${item.text}">${githubIcon}</a></li>`
      : `<li><a href="${withBase(item.link)}">${item.text}</a></li>`,
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
                `<li><a href="${withBase(item.link)}"${
                  item.link === activeLink ? ' aria-current="page"' : ''
                }>${item.text}${
                  item.tag ? `<span class="sidebar-tag">${escapeHtml(item.tag)}</span>` : ''
                }</a></li>`,
            )
            .join('\n')}
        </ul>
      </section>`,
    )
    .join('\n')
}

// Reading minutes per outline section, measured from the rendered article so
// that generated blocks (diagrams, demos, tables) count the same as prose.
// 200 words a minute is the low end of adult silent reading, which suits
// reference pages people read carefully rather than skim.
const WORDS_PER_MINUTE = 200

function annotateReadingTime(articleHtml, headings) {
  const marks = [...articleHtml.matchAll(/<h([23]) id="([^"]+)"/g)]
  const words = (html) =>
    html
      // Chart tick labels are not reading. A page of build-time SVG charts
      // counts thousands of axis numbers otherwise, and tells a reader it is a
      // twenty-minute page when the prose is three.
      .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
      // A closed disclosure is not on screen at rest either.
      .replace(/<details(?![^>]*\bopen\b)[^>]*>[\s\S]*?<\/details>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&[a-z]+;|&#\d+;/gi, ' ')
      .split(/\s+/)
      .filter(Boolean).length
  const counted = new Map()
  for (const [index, mark] of marks.entries()) {
    const start = mark.index
    const end = index + 1 < marks.length ? marks[index + 1].index : articleHtml.length
    counted.set(mark[2], words(articleHtml.slice(start, end)))
  }
  // Everything above the first section belongs to the page, not to a heading,
  // so it lands on the total without giving the first item a misleading badge.
  const lead = marks.length > 0 ? words(articleHtml.slice(0, marks[0].index)) : words(articleHtml)
  for (const heading of headings) heading.words = counted.get(heading.id) ?? 0
  return lead
}

function readingMinutes(words) {
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

function outlineHtml(headings, leadWords = 0) {
  const items = headings.filter((h) => h.depth === 2 || h.depth === 3)
  if (items.length === 0) return ''
  const total = readingMinutes(
    leadWords + items.reduce((sum, h) => sum + (h.words ?? 0), 0),
  )
  // Without JS the bar sits at zero and the readout names the whole page, which
  // is exactly true for a reader who has not scrolled.
  return `
    <nav class="outline" aria-labelledby="outline-title">
      <p class="outline-title" id="outline-title">On this page</p>
      <div class="outline-progress" data-total-minutes="${total}">
        <div class="outline-progress-track" aria-hidden="true"><div class="outline-progress-fill"></div></div>
        <p class="outline-remaining" aria-live="polite">${total} min read</p>
      </div>
      <ul>
        ${items
          .map(
            (h) =>
              `<li class="outline-depth-${h.depth}"><a href="#${h.id}">${escapeHtml(h.text)}</a></li>`,
          )
          .join('\n')}
      </ul>
    </nav>`
}

function prevNextHtml(pageIndex, flat) {
  if (pageIndex < 0) return ''
  const prev = flat[pageIndex - 1]
  const next = flat[pageIndex + 1]
  if (!prev && !next) return ''
  const cell = (item, kind, label) =>
    item
      ? `<div class="pager-link ${kind}"><a href="${withBase(item.link)}"><span class="pager-label">${label}</span><span class="pager-title">${item.text}</span></a></div>`
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

const favicon = withBase('/assets/logo.svg')
const socialImage = `${config.origin}${withBase('/assets/social-card.png')}`

function canonicalUrl(pathname) {
  if (pathname === '/') return `${config.origin}${trimmedBase || '/'}`
  return `${config.origin}${withBase(pathname)}`
}

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
    <a class="site-title" href="${withBase('/')}"><img class="site-logo" src="${withBase('/assets/logo.svg')}" alt="" width="26" height="26" />${config.title}</a>
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

function pageShell({ title, description, pathname, shell, bodyClass, header, main }) {
  if (!CSS_SHELLS.includes(shell)) {
    throw new Error(`pageShell: unknown shell ${shell} for ${pathname}`)
  }
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
<meta property="og:image" content="${socialImage}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:image:alt" content="${escapeHtml(config.title)}" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${escapeHtml(fullTitle)}" />
<meta name="twitter:description" content="${escapeHtml(summary)}" />
<meta name="twitter:image" content="${socialImage}" />
<meta name="twitter:image:alt" content="${escapeHtml(config.title)}" />
<meta name="color-scheme" content="light dark" />
<link rel="icon" href="${favicon}" />
<link rel="preload" href="${withBase('/assets/fonts/space-grotesk-latin.woff2')}" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="${withBase('/assets/fonts/inter-latin.woff2')}" as="font" type="font/woff2" crossorigin />
<script>${themeInit}</script>
<link rel="stylesheet" href="${withBase(`/assets/style-${shell}.css`)}?v=${assetVersion}" />
</head>
<body class="${bodyClass}">
<a class="skip-link" href="#main-content">Skip to content</a>
${header}
${main}
${searchDialog}
<div id="route-announcer" class="visually-hidden" aria-live="polite"></div>
<script type="module" src="${withBase('/assets/app.js')}?v=${assetVersion}"></script>
</body>
</html>
`
}

// ---------- disclosure (the detail a reader wants once, not on the way past) ----------
// `<!-- details:Summary -->` ... `<!-- /details -->` folds everything between
// the two behind a summary line. It is for the paragraph that is true, worth
// keeping, and not needed to take the next step: why a flag exists, what a
// warning means, what was measured. A `<details>` element rather than a
// scripted panel, so it still opens with JavaScript off and prints expanded.
const DISCLOSURE_PATTERN = /<!-- details:([\s\S]*?) -->([\s\S]*?)<!-- \/details -->/g

function disclosureHtml(article) {
  return article.replace(
    DISCLOSURE_PATTERN,
    (_match, summary, body) =>
      `<details class="disclosure"><summary>${escapeHtml(summary.trim())}</summary>\n${body.trim()}\n</details>\n`,
  )
}

// The Markdown twin keeps the words: an export has no disclosure to open, so a
// reader (or a model) reading the export gets the heading and the body inline.
function disclosureMarkdown(body) {
  return body.replace(
    DISCLOSURE_PATTERN,
    (_match, summary, inner) => `**${summary.trim()}**\n${inner.trim()}\n`,
  )
}

// ---------- engine-backed guide figures ----------
// A marker on its own line, immediately followed by a ```tsrx fence, becomes a
// figure that docs/assets/yuku-explorers.js drives with the WebAssembly build
// of the dialect running in the reader's tab. The build ships the fence and the
// panes; it never ships an answer. Nothing on the page is a recorded or
// approximated engine result, so with JavaScript off, or with the module
// unable to start, the figure stays the highlighted fence and says so.
const GUIDE_FIGURES = {
  'ast-explorer': {
    attribute: 'data-ast-explorer',
    className: 'ast-explorer',
    panes: ['Source', 'AST'],
    idleNote: 'The parser runs when this figure scrolls into view.',
    idleStatus:
      'the parser runs in your browser when this figure scrolls into view; with JavaScript off this stays the listing above',
    readout: 'Focus or hover a node or source token to read its span.',
    twin: 'On the site this is an interactive figure: the parser runs in your browser and hovering a node highlights the source it came from.',
  },
  'symbol-explorer': {
    attribute: 'data-symbol-explorer',
    className: 'symbol-explorer',
    panes: ['Source', 'Symbols'],
    idleNote: 'The analyzer runs when this figure scrolls into view.',
    idleStatus:
      'the analyzer runs in your browser when this figure scrolls into view; with JavaScript off this stays the listing above',
    readout: 'Focus or hover a name to read its symbol and scope.',
    twin: 'On the site this is an interactive figure: the analyzer runs in your browser and clicking a symbol lights its declaration and every reference to it.',
  },
  'codegen-walkthrough': {
    attribute: 'data-codegen-walkthrough',
    className: 'codegen-walkthrough',
    panes: ['Source', 'Generated'],
    idleNote: 'The generator runs when this figure scrolls into view.',
    idleStatus:
      'the generator runs in your browser when this figure scrolls into view; with JavaScript off this stays the listing above',
    readout: 'Edit the source or change an option to regenerate the output.',
    twin: 'On the site this is an interactive figure: every option below is a control, and the output is what the generator running in your browser returns for it.',
  },
}

const FIGURE_MARKER = /<!-- (ast-explorer|symbol-explorer|codegen-walkthrough) -->/g
const FIGURE_WITH_FENCE =
  /<!-- (ast-explorer|symbol-explorer|codegen-walkthrough) -->\n+```tsrx[^\n]*\n([\s\S]*?)\n```/g

// The fence text is taken from the Markdown, not read back out of the rendered
// HTML, so the string the figure hands to the engine is byte for byte the one
// `node tools/wasm-smoke.mjs --fences` proved parses clean.
function collectFigureSources(body, sourcePath) {
  // matchAll copies the source regex's lastIndex, and these two are module
  // level, so both are rewound before every use.
  FIGURE_MARKER.lastIndex = 0
  FIGURE_WITH_FENCE.lastIndex = 0
  const markers = [...body.matchAll(FIGURE_MARKER)]
  const withFence = [...body.matchAll(FIGURE_WITH_FENCE)]
  if (markers.length !== withFence.length) {
    throw new Error(
      `${sourcePath}: a guide figure marker is not followed by a \`\`\`tsrx fence (${markers.length} markers, ${withFence.length} usable)`,
    )
  }
  return withFence.map((match) => ({ kind: match[1], source: match[2] }))
}

// The rendered fence is one `<div class="code-block">`; find where it closes so
// the figure can wrap it whole, shiki spans, hovers, try button and all.
function codeBlockEnd(html, start) {
  const tag = /<div\b|<\/div>/g
  tag.lastIndex = start
  let depth = 0
  let match
  while ((match = tag.exec(html)) !== null) {
    if (match[0] === '</div>') {
      depth -= 1
      if (depth === 0) return tag.lastIndex
    } else {
      depth += 1
    }
  }
  return -1
}

function takeTryButton(html) {
  const match =
    /<button type="button" class="try-button" data-code="[^"]*">Try in playground<\/button>/.exec(
      html,
    )
  return {
    html: match ? html.slice(0, match.index) + html.slice(match.index + match[0].length) : html,
    button: match?.[0] ?? '',
  }
}

function appendToToolbar(html, button) {
  if (!button) return html
  const toolbar = /<div\b[^>]*class="[^"]*\bex-toolbar\b[^"]*"[^>]*>/.exec(html)
  const end = toolbar ? codeBlockEnd(html, toolbar.index) : -1
  if (end === -1) throw new Error('a figure carrying a try button has no toolbar')
  const close = end - '</div>'.length
  return html.slice(0, close) + button + html.slice(close)
}

function guideFigureHtml(kind, source, blockHtml) {
  const spec = GUIDE_FIGURES[kind]
  const fence = takeTryButton(blockHtml)
  const scopePane =
    kind === 'symbol-explorer'
      ? `<section class="ex-scope-pane" data-ex-scope-pane aria-label="Scope tree">
        <h4>Scope tree</h4>
        <ul class="ex-tree ex-scope-tree" data-ex-scope-tree><li class="ex-note">The analyzer builds this tree in your browser.</li></ul>
      </section>`
      : ''
  return `<figure class="explorer ex-figure ${spec.className}" ${spec.attribute} data-source="${escapeHtml(source)}">
  <div class="projection-map-panes">
    <div class="projection-map-pane">
      <h3>${spec.panes[0]}</h3>
      <div class="ex-source-host" data-ex-source>${fence.html}</div>
      <div class="explorer-diagnostics" data-ex-diagnostics></div>
    </div>
    <div class="projection-map-pane">
      <h3>${spec.panes[1]}</h3>
      <div class="ex-out" data-ex-out><p class="ex-note">${spec.idleNote}</p></div>
      ${scopePane}
      <p class="ex-readout" data-ex-readout aria-live="polite">${spec.readout}</p>
    </div>
  </div>
  <div class="ex-controls ex-toolbar" data-ex-controls>${fence.button}</div>
  <figcaption class="ex-status" data-ex-status aria-live="polite">${spec.idleStatus}</figcaption>
</figure>
`
}

function renderGuideFigures(article, sources, sourcePath) {
  let out = ''
  let cursor = 0
  let index = 0
  FIGURE_MARKER.lastIndex = 0
  let match
  while ((match = FIGURE_MARKER.exec(article)) !== null) {
    const blockStart = article.indexOf('<div class="code-block"', match.index)
    const blockEnd = blockStart === -1 ? -1 : codeBlockEnd(article, blockStart)
    if (blockEnd === -1) {
      throw new Error(`${sourcePath}: the <!-- ${match[1]} --> marker has no rendered fence after it`)
    }
    const entry = sources[index]
    if (!entry || entry.kind !== match[1]) {
      throw new Error(`${sourcePath}: guide figure markers and fences do not line up`)
    }
    out += article.slice(cursor, match.index)
    out += guideFigureHtml(match[1], entry.source, article.slice(blockStart, blockEnd))
    cursor = blockEnd
    index += 1
    FIGURE_MARKER.lastIndex = blockEnd
  }
  return out + article.slice(cursor)
}

// The Markdown twin keeps the fence and says, in one sentence, what the site
// does with it. It never carries an output the reader cannot reproduce.
function guideFigureMarkdown(body) {
  FIGURE_MARKER.lastIndex = 0
  return body.replace(FIGURE_MARKER, (_match, kind) => GUIDE_FIGURES[kind].twin)
}

const hasGuideFigure = (body) =>
  /<!-- (?:ast-explorer|symbol-explorer|codegen-walkthrough) -->/.test(body)

// ---------- recorded terminal walkthroughs ----------
// `<!-- terminal-demo:NAME -->` embeds docs/transcripts/NAME.json, written by
// tools/capture-transcripts.mjs from real runs on a real machine. This build
// never invokes zig or a test runner, so what a reader sees is a recording with
// the date and the machine on it, not a re-enactment. A missing transcript is a
// build failure rather than a placeholder, and so is an entry that did not exit
// zero: failing commands are dropped at capture time, never published.
const transcriptsDir = path.join(docsDir, 'transcripts')
const TERMINAL_DEMO_MARKER = /<!-- terminal-demo:([a-z0-9-]+) -->/g

async function loadTranscript(name) {
  const file = path.join(transcriptsDir, `${name}.json`)
  const relative = path.relative(repoRoot, file)
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    throw new Error(`missing ${relative}: run \`pnpm run docs:transcripts\` first`)
  }
  const demo = JSON.parse(raw)
  if (!Array.isArray(demo.transcript) || demo.transcript.length === 0) {
    throw new Error(`${relative}: the transcript is empty`)
  }
  if (!demo.captured_at || Number.isNaN(Date.parse(demo.captured_at))) {
    throw new Error(`${relative}: captured_at is not a date`)
  }
  for (const entry of demo.transcript) {
    if (entry.exit_code !== 0) {
      throw new Error(
        `${relative}: \`${entry.command}\` exited ${entry.exit_code}; a command that fails is dropped at capture, never published`,
      )
    }
  }
  return demo
}

const OMITTED_MARKER = /^\.{3} \d+ lines omitted \.{3}$/

function transcriptOutputHtml(output) {
  const lines = output.split('\n')
  return lines
    .map((line, index) => {
      if (index === lines.length - 1 && line === '') return ''
      // The trim marker is the tool speaking, not the command, so it is styled
      // as a comment rather than passed off as output.
      // Deliberately narrow: a compiler's own `error:` prefix, not any line
      // with the word in it. "0 errors" is a pass, and colouring it red would
      // be the figure lying about a run that succeeded.
      const kind = OMITTED_MARKER.test(line.trim())
        ? ' gs-terminal-comment'
        : /(^|:\d+:\d+: )error:/.test(line)
          ? ' gs-terminal-line-error'
          : /(^|:\d+:\d+: )warning:/.test(line)
            ? ' gs-terminal-line-warning'
            : ''
      return `<span class="gs-terminal-line gs-terminal-output${kind}">${escapeHtml(line)}</span>${index < lines.length - 1 ? '\n' : ''}`
    })
    .join('')
}

function terminalDemoHtml(demo, name) {
  const transcript = demo.transcript
    .map((entry) => {
      const parts = []
      if (entry.comment) {
        parts.push(
          `<span class="gs-terminal-line gs-terminal-comment"># ${escapeHtml(entry.comment)}</span>`,
        )
      }
      parts.push(
        `<span class="gs-terminal-line gs-terminal-command">${escapeHtml(entry.command)}</span>`,
      )
      const output = transcriptOutputHtml(entry.output)
      if (output) parts.push(output)
      // The exit status is the part a reader cannot infer from the output, and
      // it is the reason this transcript is on the page at all.
      parts.push(
        `<span class="gs-terminal-line gs-terminal-comment"># exit ${entry.exit_code}</span>`,
      )
      return parts.join('\n')
    })
    .join('\n\n')
  const regionLabel = `Recorded output of ${demo.transcript[0].command}`
  return `<figure class="gs-terminal" data-terminal-demo="${name}">
  <div class="gs-terminal-titlebar">
    <span class="gs-terminal-title">See it run</span>
    <button type="button" data-terminal-play aria-label="Play terminal walkthrough">Play</button>
  </div>
  <pre class="gs-terminal-transcript" role="region" aria-label="${escapeHtml(regionLabel)}" tabindex="0">${transcript}</pre>
</figure>
`
}

// The Markdown twin is the same recording as plain text. Nothing is added and
// nothing is summarised away, because an export that paraphrases a transcript
// is no longer a transcript.
function terminalDemoMarkdown(demo) {
  const body = demo.transcript
    .flatMap((entry) => [
      ...(entry.comment ? [`# ${entry.comment}`] : []),
      `$ ${entry.command}`,
      ...(entry.output ? [entry.output.replace(/\n+$/, '')] : []),
      `# exit ${entry.exit_code}`,
      '',
    ])
    .join('\n')
    .replace(/\n+$/, '')
  return ['```text', body, '```'].join('\n')
}

// ---------- chooser (a decision a reader makes about their own project) ----------
// `<!-- chooser -->` before a two-column table turns the first column into
// buttons and the second into the answer that button reveals. Without JS every
// answer stays on the page under its own label, which is the table again in
// prose form.
function chooserHtml(article) {
  const marker = '<!-- chooser -->'
  const markerIndex = article.indexOf(marker)
  const start = article.indexOf('<div class="table-wrap">', markerIndex)
  const end = article.indexOf('</table></div>', start)
  if (markerIndex === -1 || start === -1 || end === -1) {
    throw new Error('chooser marker found without a following table')
  }
  const table = article.slice(start, end)
  const prompt = table.match(/<th[^>]*>([\s\S]*?)<\/th>/)?.[1]?.trim()
  const rows = [
    ...table.matchAll(/<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g),
  ]
  if (!prompt || rows.length < 2) {
    throw new Error('chooser needs a two-column table with a header and at least two rows')
  }
  const options = rows.map(([, label, answer], index) => ({
    index,
    // The chip is a button, so the label has to survive as plain text.
    chip: label.replace(/<[^>]*>/g, '').trim(),
    label: label.trim(),
    answer: answer.trim(),
  }))
  const chips = options
    .map(
      (option) =>
        `<button type="button" data-chooser-option="${option.index}" aria-pressed="false">${escapeHtml(option.chip)}</button>`,
    )
    .join('\n    ')
  const panels = options
    .map(
      (option) =>
        `<div class="chooser-panel" data-chooser-panel="${option.index}">
      <p class="chooser-label">${option.label}</p>
      <p class="chooser-answer">${option.answer}</p>
    </div>`,
    )
    .join('\n    ')
  const replacement = `<div class="chooser" data-chooser>
  <p class="chooser-prompt">${prompt}</p>
  <div class="chooser-chips" role="group" aria-label="${escapeHtml(prompt.replace(/<[^>]*>/g, ''))}">
    ${chips}
  </div>
  <div class="chooser-panels">
    ${panels}
  </div>
</div>`
  return (
    article.slice(0, markerIndex) +
    article.slice(markerIndex + marker.length, start) +
    replacement +
    article.slice(end + '</table></div>'.length)
  )
}

const chooserTwin =
  'On the site this table is a chooser: you pick your route and only that answer stays on screen.'

// ---------- how it works (guide/introduction) ----------
// The five steps a `.tsrx` file goes through, and who owns each one. Everything
// here is either prose or read out of the repository at build time: the hook
// chips are the `pub fn` declarations in src/dialect/parser_extension.zig, and
// the build refuses to render the figure if that file stops declaring exactly
// twenty of them.
const HOOK_AREAS = {
  statement_at_code_block: 'Statement',
  statement_at_control_flow: 'Statement',
  expression_at_code_block: 'Expression',
  expression_at_control_flow: 'Expression',
  lazy_assignment_pattern: 'Pattern',
  function_body: 'Function',
  for_of_tail: 'For-of',
  binding_pattern: 'Pattern',
  module_specifier: 'Module',
  jsx_child_at_code_block: 'JSX',
  jsx_child_at_control_flow: 'JSX',
  jsx_element_name: 'JSX',
  function_body_starts: 'Function',
  can_start_binding: 'Pattern',
  jsx_element_after_open: 'JSX',
  jsx_fragment_after_open: 'JSX',
  validate_jsx_element_name: 'JSX',
  jsx_names_match: 'JSX',
  jsx_text_boundary: 'Text',
  jsx_text_value: 'Text',
}

const EXPECTED_HOOK_COUNT = 20

// The dialect files a hook body can hand the work to. A hook that names none of
// them does the work where it is declared.
const HOOK_MODULES = ['code_block', 'control_flow', 'jsx', 'modules', 'patterns', 'style', 'text']
// `hookNode` and `decisionNode` are the two comptime wrappers every hook goes
// through to turn a `Decision` into a node; they parse nothing, so a hook that
// calls one of them has not thereby been implemented in this file. Every other
// top-level `fn` in parser_extension.zig does real work, and a hook that calls
// one is implemented there as well as in whatever module it also calls.
const HOOK_DISPATCH_HELPERS = new Set(['hookNode', 'decisionNode'])

// Read once per build, not per page: the file is the source of truth for the
// chips, and reading it twice would only give two chances to disagree.
async function readHooks() {
  const file = path.join(repoRoot, 'src', 'dialect', 'parser_extension.zig')
  const source = await readFile(file, 'utf8')
  const declarations = [...source.matchAll(/^pub fn ([a-z_]+)\(/gm)]
  const names = declarations.map((match) => match[1])
  if (names.length !== EXPECTED_HOOK_COUNT) {
    throw new Error(
      `src/dialect/parser_extension.zig declares ${names.length} hooks, expected ${EXPECTED_HOOK_COUNT}`,
    )
  }
  const unmapped = names.filter((name) => !HOOK_AREAS[name])
  if (unmapped.length > 0) {
    throw new Error(`docs/build.mjs has no area for hook(s): ${unmapped.join(', ')}`)
  }
  const locals = [...source.matchAll(/^fn ([A-Za-z_][A-Za-z0-9_]*)\(/gm)]
    .map((match) => match[1])
    .filter((name) => !HOOK_DISPATCH_HELPERS.has(name))
  // A hook declaration runs to the next top-level `pub`, which is the next hook
  // or the trailing `pub const`.
  const boundaries = [...source.matchAll(/^pub /gm)].map((match) => match.index)
  const hooks = declarations.map((declaration, index) => {
    const start = declaration.index
    const end = boundaries.find((offset) => offset > start) ?? source.length
    const body = source.slice(start, end)
    const files = HOOK_MODULES.filter((module) =>
      new RegExp(`\\b${module}\\.[A-Za-z]`).test(body),
    ).map((module) => `${module}.zig`)
    const usesLocal = locals.some((name) => new RegExp(`\\b${name}\\(`).test(body))
    if (files.length === 0 || usesLocal) files.push('parser_extension.zig')
    return { name: declaration[1], area: HOOK_AREAS[declaration[1]], files, index }
  })
  const groups = []
  for (const name of names) {
    const area = HOOK_AREAS[name]
    const group = groups.find((candidate) => candidate.area === area)
    if (group) group.hooks.push(name)
    else groups.push({ area, hooks: [name] })
  }
  return { names, groups, hooks }
}

const TSRX_NODE_TYPES = [
  'JSXCodeBlock',
  'JSXIfExpression',
  'JSXForExpression',
  'JSXSwitchExpression',
  'JSXTryExpression',
  'TSRXExpression',
  'JSXStyleElement',
  'StyleSheet',
]

async function howItWorksSteps() {
  const { names, groups } = await readHooks()
  const nodeTypesHref = withBase(
    '/guide/parse#the-tsrx-node-types-and-why-the-names-are-exact',
  )
  const wireHref = withBase('/guide/parse#the-wire-format-underneath')
  return [
    {
      id: 'source',
      label: 'Your .tsrx',
      text: 'The file you wrote. Nothing owns it yet, and nothing on disk changes at any point in what follows.',
      panel: `<div class="hiw-source code-block" data-lang="tsrx">${addTsrxHovers(highlightHtml(heroCode, 'tsrx'))}</div>`,
    },
    {
      id: 'hooks',
      label: 'Yuku parses, the dialect answers',
      text: `Yuku owns the JavaScript and TypeScript grammar. yuku-tsrx owns only the ${names.length} answers below, declared in <code>src/dialect/parser_extension.zig</code> and resolved at compile time.`,
      panel: `<div class="hiw-hooks">${groups
        .map(
          (group) =>
            `<div class="hiw-hook-group"><h4>${escapeHtml(group.area)}</h4><p class="hiw-hook-chips">${group.hooks
              .map((name) => `<code>${escapeHtml(name)}</code>`)
              .join(' ')}</p></div>`,
        )
        .join('\n')}</div>`,
    },
    {
      id: 'tree',
      label: 'A TSRX tree, not a lowering',
      text: 'Yuku owns the ordinary nodes. yuku-tsrx owns these records, declared in <code>src/dialect/schema.zig</code>, and the parser produces those exact names rather than lowering TSRX to TSX.',
      panel: `<p class="hiw-nodes">${TSRX_NODE_TYPES.map(
        (type) => `<a href="${nodeTypesHref}"><code>${type}</code></a>`,
      ).join(' ')}</p>`,
    },
    {
      id: 'buffer',
      label: 'One buffer across the boundary',
      text: 'The tree crosses into JavaScript as a single buffer, decoded on the JavaScript side rather than built node by node in the addon.',
      panel: `<p>The layout, and what the decoder does with it, is written up in <a href="${wireHref}">The wire format underneath</a>. The Zig side of it is <code>src/dialect/transfer.zig</code> and <code>src/dialect/semantic_transfer.zig</code>.</p>`,
    },
    {
      id: 'api',
      label: 'parse, analyze, generate',
      text: 'Three calls on the JavaScript side, each with its own guide.',
      panel: `<ul class="hiw-api">
        <li><a href="${withBase('/guide/parse')}"><code>parse</code> and <code>parseModule</code></a>: source in, a TSRX tree and its diagnostics out.</li>
        <li><a href="${withBase('/guide/analyze')}"><code>analyze</code></a>: scopes, symbols and references over that tree.</li>
        <li><a href="${withBase('/guide/generate')}"><code>generate</code></a>: a tree back to source.</li>
      </ul>
      <p>The same module compiled to WebAssembly is what runs in the <a href="${withBase(PLAYGROUND_ROUTE)}">playground</a> and in the figures on the guide pages.</p>`,
    },
  ]
}

async function howItWorksHtml() {
  const steps = await howItWorksSteps()
  return `<figure class="how-it-works hiw-yuku" data-how-it-works>
  <div class="hiw-steps" role="group" aria-label="The five steps from a .tsrx file to a JavaScript API">
    ${steps
      .map(
        (step, index) =>
          `<button type="button" data-hiw-step="${step.id}" aria-pressed="false"><span class="pipeline-step" aria-hidden="true">${index + 1}</span>${escapeHtml(step.label)}</button>`,
      )
      .join('\n    ')}
  </div>
  <div class="hiw-strip" aria-live="polite">
    ${steps.map((step) => `<p class="hiw-text" data-hiw-text="${step.id}">${step.text}</p>`).join('\n    ')}
  </div>
  ${steps
    .map((step) => `<div class="hiw-panel" data-hiw-panel="${step.id}">${step.panel}</div>`)
    .join('\n  ')}
</figure>
`
}

async function howItWorksMarkdown() {
  const steps = await howItWorksSteps()
  return steps
    .map(
      (step, index) =>
        `${index + 1}. **${step.label}.** ${step.text.replace(/<\/?code>/g, '`').replace(/<[^>]*>/g, '')}`,
    )
    .join('\n')
}

// ---------- the parser, running inside this build ----------
// The chips under every example on guide/tsrx-syntax name node types the parser
// produced for that example, so this build instantiates the same WebAssembly
// module the site ships and asks it. It is the instantiation in
// tools/wasm-smoke.mjs: same flag packing, same length-prefixed result, the same
// generated decoder out of npm/yuku. There is no fallback list and no
// hand-written chip anywhere in this file: a build that cannot start the engine
// has nothing truthful to print, so it fails instead.
const BUILD_SOURCE_TYPES = ['script', 'module', 'commonjs']
const BUILD_LANGS = ['js', 'ts', 'jsx', 'tsx', 'dts']

function packBuildFlags({
  sourceType = 'module',
  lang = 'tsx',
  preserveParens = true,
  semanticErrors = true,
} = {}) {
  const sourceTypeIndex = BUILD_SOURCE_TYPES.indexOf(sourceType)
  const langIndex = BUILD_LANGS.indexOf(lang)
  if (sourceTypeIndex < 0) throw new Error(`unknown sourceType ${sourceType}`)
  if (langIndex < 0) throw new Error(`unknown lang ${lang}`)
  let flags = sourceTypeIndex
  flags |= langIndex << 2
  if (preserveParens) flags |= 1 << 5
  if (semanticErrors) flags |= 1 << 6
  return flags >>> 0
}

let buildEngine = null

async function bootWasmForBuild() {
  if (buildEngine) return buildEngine
  const relative = path.relative(repoRoot, wasmPath)
  let bytes
  try {
    bytes = await readFile(wasmPath)
  } catch {
    throw new Error(`missing ${relative}: run \`pnpm run docs:wasm\` first`)
  }
  let instance
  try {
    instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {})
  } catch (error) {
    throw new Error(`${relative} did not instantiate in Node: ${error.message}`)
  }
  for (const name of ['memory', 'alloc', 'free', 'parse']) {
    if (!(name in instance.exports)) throw new Error(`${relative}: missing export \`${name}\``)
  }
  const { decode } = await import(
    pathToFileURL(path.join(repoRoot, 'npm', 'yuku', 'decode.js')).href
  )
  buildEngine = { exports: instance.exports, decode }
  return buildEngine
}

const buildEncoder = new TextEncoder()

// Every call may grow the memory, so each view is built from the current buffer.
async function parseForBuild(source) {
  const engine = await bootWasmForBuild()
  const bytes = buildEncoder.encode(source)
  const len = Math.max(bytes.length, 1)
  const ptr = engine.exports.alloc(len)
  if (ptr === 0) throw new Error('yuku-tsrx wasm: alloc returned 0')
  new Uint8Array(engine.exports.memory.buffer, ptr, bytes.length).set(bytes)
  let payload
  try {
    const result = engine.exports.parse(ptr, bytes.length, packBuildFlags())
    if (result === 0) throw new Error('yuku-tsrx wasm: parse returned a null pointer')
    const length = new DataView(engine.exports.memory.buffer).getUint32(result, true)
    payload = engine.exports.memory.buffer.slice(result + 4, result + 4 + length)
    engine.exports.free(result, 4 + length)
  } finally {
    engine.exports.free(ptr, len)
  }
  return engine.decode(payload, source)
}

// ---------- node-type chips (guide/tsrx-syntax) ----------
// A page carrying `<!-- node-chips -->` gets, under every ```tsrx fence, the
// TSRX node types the parser produced for that exact fence text. Two kinds of
// answer are on the page, and both are read out of the decoded tree:
//
// - a record, which is a standalone TSRX node the dialect owns (schema.zig);
// - an overlay, which is an ordinary Yuku node carrying a field the dialect
//   added, so the chip names the node and the field rather than a type that
//   does not exist.
//
// Nothing here inspects the source text for an `@`; every chip is a question
// asked of a node the parser returned.
const NODE_CHIPS_MARKER = '<!-- node-chips -->'
const TSRX_RECORD_TYPES = new Set(TSRX_NODE_TYPES)

const TSRX_OVERLAYS = [
  {
    chip: 'ForOfStatement.index',
    title: 'the `; index <name>` clause, an extra field on an ordinary ForOfStatement',
    test: (node) => node.type === 'ForOfStatement' && node.index != null,
  },
  {
    chip: 'ForOfStatement.key',
    title: 'the `; key <expr>` clause, an extra field on an ordinary ForOfStatement',
    test: (node) => node.type === 'ForOfStatement' && node.key != null,
  },
  {
    chip: 'ObjectPattern.lazy',
    title: 'a `&{ }` pattern: the lazy marking sits on the ordinary ObjectPattern',
    test: (node) => node.type === 'ObjectPattern' && node.lazy === true,
  },
  {
    chip: 'ArrayPattern.lazy',
    title: 'a `&[ ]` pattern: the lazy marking sits on the ordinary ArrayPattern',
    test: (node) => node.type === 'ArrayPattern' && node.lazy === true,
  },
  {
    chip: 'CatchClause.resetParam',
    title: 'the second `@catch` parameter, an extra field on an ordinary CatchClause',
    test: (node) => node.type === 'CatchClause' && node.resetParam != null,
  },
  {
    chip: 'JSXOpeningElement.name',
    title: 'a dynamic tag: the element name is a JSXExpressionContainer, not an identifier',
    test: (node) =>
      node.type === 'JSXOpeningElement' && node.name?.type === 'JSXExpressionContainer',
  },
  {
    chip: 'ImportDeclaration.source',
    title: 'a submodule import: the specifier is an identifier, not a string literal',
    test: (node) => node.type === 'ImportDeclaration' && node.source?.type !== 'Literal',
  },
  {
    chip: 'JSXText.value',
    title: 'text entities decoded by the dialect, so value is not the source it came from',
    test: (node, source) =>
      node.type === 'JSXText' && node.value !== source.slice(node.start, node.end),
  },
]

function walkTree(program, visit) {
  const seen = new Set()
  const step = (value) => {
    if (value === null || typeof value !== 'object' || seen.has(value)) return
    seen.add(value)
    if (Array.isArray(value)) {
      for (const child of value) step(child)
      return
    }
    if (typeof value.type === 'string') visit(value)
    for (const [key, child] of Object.entries(value)) {
      if (key === 'comments') continue
      step(child)
    }
  }
  step(program)
}

function tsrxChips(program, source) {
  const records = new Set()
  const overlays = new Set()
  walkTree(program, (node) => {
    if (TSRX_RECORD_TYPES.has(node.type)) records.add(node.type)
    for (const overlay of TSRX_OVERLAYS) {
      if (overlay.test(node, source)) overlays.add(overlay.chip)
    }
  })
  return [
    ...TSRX_NODE_TYPES.filter((type) => records.has(type)).map((type) => ({
      chip: type,
      title: `a TSRX record node, declared in src/dialect/schema.zig`,
    })),
    ...TSRX_OVERLAYS.filter((overlay) => overlays.has(overlay.chip)),
  ]
}

// One parse per fence, keyed by the exact fence text, so the renderer and the
// Markdown twin cannot disagree and neither can invent a fence the parser was
// never given.
async function nodeChipEntries(body, sourcePath) {
  const entries = new Map()
  const fences = [...body.matchAll(/^```tsrx([^\n]*)\n([\s\S]*?)\n```$/gm)]
  if (fences.length === 0) {
    throw new Error(`${sourcePath}: the ${NODE_CHIPS_MARKER} marker is on a page with no tsrx fence`)
  }
  for (const [, info, code] of fences) {
    if (entries.has(code)) continue
    let result
    try {
      result = await parseForBuild(code)
    } catch (error) {
      throw new Error(`${sourcePath}: a tsrx fence did not parse in the build: ${error.message}`)
    }
    entries.set(code, {
      chips: tsrxChips(result.program, code),
      diagnostics: result.diagnostics,
      invalid: /\bno-playground\b/.test(info),
    })
  }
  return entries
}

function nodeChipsHtml(entry) {
  const chips = entry.chips.map(
    (chip) =>
      `<span class="node-chip" title="${escapeHtml(chip.title)}"><code>${escapeHtml(chip.chip)}</code></span>`,
  )
  if (entry.diagnostics.length > 0) {
    chips.push(
      `<span class="node-chip node-chip-diag" title="${escapeHtml(
        entry.diagnostics[0].message,
      )}">${entry.diagnostics.length} diagnostic${entry.diagnostics.length === 1 ? '' : 's'}</span>`,
    )
  }
  if (chips.length === 0) {
    chips.push(
      '<span class="node-chip node-chip-plain" title="the parser produced ordinary Yuku nodes for this example and no TSRX record or overlay">no TSRX-only nodes</span>',
    )
  }
  return `<p class="node-chips" aria-label="TSRX node types the parser produced for this example">${chips.join(
    '',
  )}</p>\n`
}

function nodeChipsSentence(entry) {
  const names = entry.chips.map((chip) => chip.chip)
  const parts = []
  parts.push(
    names.length > 0
      ? `The parser produced ${names.join(', ')} for this example.`
      : 'The parser produced ordinary Yuku nodes for this example and no TSRX record or overlay.',
  )
  if (entry.diagnostics.length > 0) {
    parts.push(
      `${entry.diagnostics.length} diagnostic${entry.diagnostics.length === 1 ? '' : 's'}: ${entry.diagnostics[0].message}.`,
    )
  }
  return `*${parts.join(' ')}*`
}

const NODE_CHIPS_NOTE =
  'The chips under each example are the node types the parser produced for it. They are not written by hand: this page is built by handing every example below to the WebAssembly build of yuku-tsrx and reading the tree that comes back.'

function nodeChipsMarkdown(body, entries) {
  return body
    .replace(NODE_CHIPS_MARKER, NODE_CHIPS_NOTE)
    .replace(/^```tsrx([^\n]*)\n([\s\S]*?)\n```$/gm, (match, _info, code) => {
      const entry = entries.get(code)
      return entry ? `${match}\n\n${nodeChipsSentence(entry)}` : match
    })
}

// ---------- extension-point matrix (architecture/yuku-dialect) ----------
// `<!-- hook-matrix -->` before the twenty-hook table turns it into a table you
// can filter by area, and adds the file each hook hands the work to. Both the
// names and the files are read out of src/dialect/parser_extension.zig at build
// time: if the table and the zig disagree on a name, or on how many there are,
// the build stops rather than publishing a table that has drifted.
const AREA_SLUGS = {
  Statement: 'statement',
  Expression: 'expression',
  Pattern: 'pattern',
  Function: 'function',
  'For-of': 'for-of',
  Module: 'module',
  JSX: 'jsx',
  Text: 'text',
}

function hookMatrixHtml(article, hooks, sourcePath) {
  const marker = '<!-- hook-matrix -->'
  const markerIndex = article.indexOf(marker)
  const start = article.indexOf('<div class="table-wrap">', markerIndex)
  const end = article.indexOf('</table></div>', start)
  if (markerIndex === -1 || start === -1 || end === -1) {
    throw new Error(`${sourcePath}: the ${marker} marker has no table after it`)
  }
  const table = article.slice(start, end)
  const rows = [
    ...table.matchAll(
      /<tr>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/g,
    ),
  ]
  if (rows.length !== hooks.length) {
    throw new Error(
      `${sourcePath}: the hook table has ${rows.length} rows, but src/dialect/parser_extension.zig declares ${hooks.length} hooks`,
    )
  }
  const body = rows.map(([, hookCell, areaCell, roleCell], index) => {
    const hook = hooks[index]
    const name = hookCell.replace(/<[^>]*>/g, '').trim()
    if (name !== hook.name) {
      throw new Error(
        `${sourcePath}: row ${index + 1} of the hook table is \`${name}\`, but src/dialect/parser_extension.zig declares \`${hook.name}\` there`,
      )
    }
    const area = areaCell.replace(/<[^>]*>/g, '').trim()
    if (area !== hook.area) {
      throw new Error(
        `${sourcePath}: row ${index + 1} (\`${name}\`) is filed under ${area}, but docs/build.mjs files it under ${hook.area}`,
      )
    }
    const slug = AREA_SLUGS[area]
    if (!slug) throw new Error(`${sourcePath}: no chip slug for the area ${area}`)
    const files = hook.files
      .map((file) => `<code>${escapeHtml(file)}</code>`)
      .join(' ')
    return `<tr data-classification="${slug}"><td>${hookCell.trim()}</td><td><span class="matrix-badge matrix-badge-${slug}">${escapeHtml(
      area,
    )}</span></td><td>${files}</td><td>${roleCell.trim()}</td></tr>`
  })
  const counts = new Map()
  for (const hook of hooks) counts.set(hook.area, (counts.get(hook.area) ?? 0) + 1)
  const chips = [
    `<button type="button" data-matrix-chip="all" aria-pressed="true">All <span class="matrix-count">${hooks.length}</span></button>`,
    ...[...counts].map(
      ([area, count]) =>
        `<button type="button" data-matrix-chip="${AREA_SLUGS[area]}" aria-pressed="false"><span class="matrix-badge matrix-badge-${AREA_SLUGS[area]}" aria-hidden="true"></span>${escapeHtml(
          area,
        )} <span class="matrix-count">${count}</span></button>`,
    ),
  ].join('\n    ')
  const replacement = `<div class="matrix-filter" data-matrix-filter data-matrix-noun="hooks">
  <div class="matrix-chips" role="group" aria-label="Filter the extension points by the area of the grammar they sit in">
    ${chips}
  </div>
  <p class="matrix-status" data-matrix-status aria-live="polite">Showing all ${hooks.length} hooks.</p>
  <div class="table-wrap"><table>
<thead><tr><th>Hook</th><th>Area</th><th>Implemented in</th><th>Where TSRX gets a say</th></tr></thead>
<tbody>
${body.join('\n')}
</tbody></table></div>
</div>`
  return (
    article.slice(0, markerIndex) +
    article.slice(markerIndex + marker.length, start) +
    replacement +
    article.slice(end + '</table></div>'.length)
  )
}

const hookMatrixTwin =
  'On the site this table is filterable by area, and the build adds a column naming the file in `src/dialect/` each hook hands the work to, read out of `src/dialect/parser_extension.zig`.'

// ---------- widget registry ----------
// `<!-- widget:NAME key=value flag -->`, optionally followed by a fence that
// becomes the widget's seed, is rendered by docs/widgets/NAME.mjs at build time
// and driven by docs/assets/widgets/NAME.js in the reader's tab. Both files must
// exist: a marker with no module is a build failure, never an empty box.
const WIDGET_MARKER = /<!-- widget:([a-z][a-z0-9-]*)((?:\s+[a-z][a-z0-9-]*(?:="[^"]*"|=[^\s>]+)?)*)\s*-->/g
const WIDGET_FENCE = /\n+```([^\n]*)\n([\s\S]*?)\n```/y
const widgetsDir = path.join(docsDir, 'widgets')
const widgetRuntimeDir = path.join(docsDir, 'assets', 'widgets')
const widgetModules = new Map()

function parseWidgetAttrs(raw) {
  const attrs = {}
  for (const [, key, quoted, bare] of raw.matchAll(/([a-z][a-z0-9-]*)(?:="([^"]*)"|=([^\s>]+))?/g)) {
    attrs[key] = quoted ?? bare ?? 'true'
  }
  return attrs
}

async function loadWidgetModule(name, sourcePath) {
  if (widgetModules.has(name)) return widgetModules.get(name)
  const buildFile = path.join(widgetsDir, `${name}.mjs`)
  const runtimeFile = path.join(widgetRuntimeDir, `${name}.js`)
  for (const [file, side] of [
    [buildFile, 'build'],
    [runtimeFile, 'runtime'],
  ]) {
    try {
      await lstat(file)
    } catch {
      throw new Error(
        `${sourcePath}: <!-- widget:${name} --> has no ${side} module; expected ${path.relative(repoRoot, file)}`,
      )
    }
  }
  const module = await import(pathToFileURL(buildFile).href)
  if (typeof module.default !== 'function') {
    throw new Error(`${path.relative(repoRoot, buildFile)} must default-export render({ attrs, fence, page, ctx })`)
  }
  widgetModules.set(name, module)
  return module
}

let nodeEngine = null
const widgetEngine = async () => {
  nodeEngine ??= await createNodeEngine({
    wasmPath,
    decodersDir: path.join(repoRoot, 'npm', 'yuku'),
  })
  return nodeEngine
}

// What every widget's render() gets: the highlighter, the engine in Node, the
// committed fixtures, and the site's path helpers.
const widgetContext = {
  base,
  withBase,
  escapeHtml,
  repoRoot,
  highlight: (code, lang) =>
    lang === 'tsrx' ? addTsrxHovers(highlightHtml(code, lang)) : highlightHtml(code, lang),
  parse: async (source, options) => (await widgetEngine()).parse(source, options),
  analyze: async (source, options) => (await widgetEngine()).analyze(source, options),
  generate: async (source, options, generateOptions) =>
    (await widgetEngine()).generate(source, options, generateOptions),
  readFixture: async (file) => {
    const fixture = path.join(repoRoot, 'test', 'parser', 'misc', 'tsrx', file)
    try {
      return await readFile(fixture, 'utf8')
    } catch {
      throw new Error(`missing fixture ${path.relative(repoRoot, fixture)}`)
    }
  },
  tsrxRecordTypes: TSRX_NODE_TYPES,
}

// The fence is taken from the Markdown, so the seed a widget ships is byte for
// byte the one `node tools/wasm-smoke.mjs --fences` checked.
function collectWidgets(body, sourcePath) {
  const widgets = []
  WIDGET_MARKER.lastIndex = 0
  let match
  while ((match = WIDGET_MARKER.exec(body)) !== null) {
    const name = match[1]
    const attrs = parseWidgetAttrs(match[2])
    WIDGET_FENCE.lastIndex = WIDGET_MARKER.lastIndex
    const fenceMatch = WIDGET_FENCE.exec(body)
    let fence = null
    if (fenceMatch) {
      const [lang, ...flags] = (fenceMatch[1].trim() || 'text').split(/\s+/)
      fence = { lang, flags, code: fenceMatch[2] }
      WIDGET_MARKER.lastIndex = WIDGET_FENCE.lastIndex
    }
    widgets.push({ name, attrs, fence, marker: match[0], sourcePath })
  }
  return widgets
}

async function renderWidgets(article, widgets, page) {
  let out = ''
  let cursor = 0
  for (const widget of widgets) {
    const at = article.indexOf(widget.marker, cursor)
    if (at === -1) {
      throw new Error(`${widget.sourcePath}: the ${widget.marker} marker did not survive rendering`)
    }
    let end = at + widget.marker.length
    let fence = widget.fence
    if (fence) {
      const blockStart = article.indexOf('<div class="code-block"', end)
      const blockEnd = blockStart === -1 ? -1 : codeBlockEnd(article, blockStart)
      if (blockEnd === -1) {
        throw new Error(`${widget.sourcePath}: the ${widget.marker} marker has no rendered fence after it`)
      }
      fence = { ...fence, html: article.slice(blockStart, blockEnd) }
      end = blockEnd
    }
    const module = await loadWidgetModule(widget.name, widget.sourcePath)
    let tryButton = ''
    if (fence) {
      const extracted = takeTryButton(fence.html)
      fence = { ...fence, html: extracted.html }
      tryButton = extracted.button
    }
    let html = await module.default({ attrs: widget.attrs, fence, page, ctx: widgetContext })
    if (typeof html !== 'string' || html.trim() === '') {
      throw new Error(`${widget.sourcePath}: widget ${widget.name} rendered nothing`)
    }
    html = appendToToolbar(html, tryButton)
    const className = typeof module.className === 'string' ? ` ${module.className}` : ''
    out += article.slice(cursor, at)
    out += `<figure class="widget widget-${widget.name}${className}" data-widget="${widget.name}">\n${html}\n</figure>\n`
    cursor = end
  }
  return out + article.slice(cursor)
}

// The Markdown twin keeps the fence and says what the site does with it; a
// widget may export markdown({ attrs, fence, page }) to say it in its own words.
async function widgetsMarkdown(body, widgets, page) {
  let out = body
  for (const widget of widgets) {
    const module = await loadWidgetModule(widget.name, widget.sourcePath)
    const twin =
      typeof module.markdown === 'function'
        ? await module.markdown({ attrs: widget.attrs, fence: widget.fence, page })
        : `On the site this is an interactive ${widget.name} widget.`
    out = out.replace(widget.marker, twin)
  }
  return out
}

const PM_INSTALL_VARIANTS = [
  {
    npm: 'npm install --save-dev',
    pnpm: 'pnpm add -D',
    yarn: 'yarn add -D',
    bun: 'bun add -d',
  },
  {
    npm: 'npm install',
    pnpm: 'pnpm add',
    yarn: 'yarn add',
    bun: 'bun add',
  },
]

const PM_EXEC_PREFIXES = {
  npm: 'npx',
  pnpm: 'pnpm exec',
  yarn: 'yarn',
  bun: 'bunx',
}

const PM_TABS_PATTERN = /<!-- pm-(?:install|exec) -->\r?\n```sh\r?\n([\s\S]*?)\r?\n```/g

// Each project's own mark, as the single-path glyphs published by Simple Icons
// (CC0; the marks themselves stay their owners' trademarks and are used here to
// name the tool they belong to). They are inlined rather than fetched, so the
// strict CSP holds, and they fill with `currentColor` so a selected tab and a
// hovered brand link tint the mark along with the label.
const BRAND_ICONS = {
  npm: 'M1.763 0C.786 0 0 .786 0 1.763v20.474C0 23.214.786 24 1.763 24h20.474c.977 0 1.763-.786 1.763-1.763V1.763C24 .786 23.214 0 22.237 0zM5.13 5.323l13.837.019-.009 13.836h-3.464l.01-10.382h-3.456L12.04 19.17H5.113z',
  pnpm: 'M0 0v7.5h7.5V0zm8.25 0v7.5h7.498V0zm8.25 0v7.5H24V0zM2 2h3.5v3.5H2zm8.25 0h3.498v3.5H10.25zm8.25 0H22v3.5h-3.5zM8.25 8.25v7.5h7.498v-7.5zm8.25 0v7.5H24v-7.5zm2 2H22v3.5h-3.5zM0 16.5V24h7.5v-7.5zm8.25 0V24h7.498v-7.5zm8.25 0V24H24v-7.5z',
  yarn: 'M12 0C5.375 0 0 5.375 0 12s5.375 12 12 12 12-5.375 12-12S18.625 0 12 0zm.768 4.105c.183 0 .363.053.525.157.125.083.287.185.755 1.154.31-.088.468-.042.551-.019.204.056.366.19.463.375.477.917.542 2.553.334 3.605-.241 1.232-.755 2.029-1.131 2.576.324.329.778.899 1.117 1.825.278.774.31 1.478.273 2.015a5.51 5.51 0 0 0 .602-.329c.593-.366 1.487-.917 2.553-.931.714-.009 1.269.445 1.353 1.103a1.23 1.23 0 0 1-.945 1.362c-.649.158-.95.278-1.821.843-1.232.797-2.539 1.242-3.012 1.39a1.686 1.686 0 0 1-.704.343c-.737.181-3.266.315-3.466.315h-.046c-.783 0-1.214-.241-1.45-.491-.658.329-1.51.19-2.122-.134a1.078 1.078 0 0 1-.58-1.153 1.243 1.243 0 0 1-.153-.195c-.162-.25-.528-.936-.454-1.946.056-.723.556-1.367.88-1.71a5.522 5.522 0 0 1 .408-2.256c.306-.727.885-1.348 1.32-1.737-.32-.537-.644-1.367-.329-2.21.227-.602.412-.936.82-1.08h-.005c.199-.074.389-.153.486-.259a3.418 3.418 0 0 1 2.298-1.103c.037-.093.079-.185.125-.283.31-.658.639-1.029 1.024-1.168a.94.94 0 0 1 .328-.06zm.006.7c-.507.016-1.001 1.519-1.001 1.519s-1.27-.204-2.266.871c-.199.218-.468.334-.746.44-.079.028-.176.023-.417.672-.371.991.625 2.094.625 2.094s-1.186.839-1.626 1.881c-.486 1.144-.338 2.261-.338 2.261s-.843.732-.899 1.487c-.051.663.139 1.2.343 1.515.227.343.51.176.51.176s-.561.653-.037.931c.477.25 1.283.394 1.71-.037.31-.31.371-1.001.486-1.283.028-.065.12.111.209.199.097.093.264.195.264.195s-.755.324-.445 1.066c.102.246.468.403 1.066.398.222-.005 2.664-.139 3.313-.296.375-.088.505-.283.505-.283s1.566-.431 2.998-1.357c.917-.598 1.293-.76 2.034-.936.612-.148.57-1.098-.241-1.084-.839.009-1.575.44-2.196.825-1.163.718-1.742.672-1.742.672l-.018-.032c-.079-.13.371-1.293-.134-2.678-.547-1.515-1.413-1.881-1.344-1.997.297-.5 1.038-1.297 1.334-2.78.176-.899.13-2.377-.269-3.151-.074-.144-.732.241-.732.241s-.616-1.371-.788-1.483a.271.271 0 0 0-.157-.046z',
  bun: 'M12 22.596c6.628 0 12-4.338 12-9.688 0-3.318-2.057-6.248-5.219-7.986-1.286-.715-2.297-1.357-3.139-1.89C14.058 2.025 13.08 1.404 12 1.404c-1.097 0-2.334.785-3.966 1.821a49.92 49.92 0 0 1-2.816 1.697C2.057 6.66 0 9.59 0 12.908c0 5.35 5.372 9.687 12 9.687v.001ZM10.599 4.715c.334-.759.503-1.58.498-2.409 0-.145.202-.187.23-.029.658 2.783-.902 4.162-2.057 4.624-.124.048-.199-.121-.103-.209a5.763 5.763 0 0 0 1.432-1.977Zm2.058-.102a5.82 5.82 0 0 0-.782-2.306v-.016c-.069-.123.086-.263.185-.172 1.962 2.111 1.307 4.067.556 5.051-.082.103-.23-.003-.189-.126a5.85 5.85 0 0 0 .23-2.431Zm1.776-.561a5.727 5.727 0 0 0-1.612-1.806v-.014c-.112-.085-.024-.274.114-.218 2.595 1.087 2.774 3.18 2.459 4.407a.116.116 0 0 1-.049.071.11.11 0 0 1-.153-.026.122.122 0 0 1-.022-.083 5.891 5.891 0 0 0-.737-2.331Zm-5.087.561c-.617.546-1.282.76-2.063 1-.117 0-.195-.078-.156-.181 1.752-.909 2.376-1.649 2.999-2.778 0 0 .155-.118.188.085 0 .304-.349 1.329-.968 1.874Zm4.945 11.237a2.957 2.957 0 0 1-.937 1.553c-.346.346-.8.565-1.286.62a2.178 2.178 0 0 1-1.327-.62 2.955 2.955 0 0 1-.925-1.553.244.244 0 0 1 .064-.198.234.234 0 0 1 .193-.069h3.965a.226.226 0 0 1 .19.07c.05.053.073.125.063.197Zm-5.458-2.176a1.862 1.862 0 0 1-2.384-.245 1.98 1.98 0 0 1-.233-2.447c.207-.319.503-.566.848-.713a1.84 1.84 0 0 1 1.092-.11c.366.075.703.261.967.531a1.98 1.98 0 0 1 .408 2.114 1.931 1.931 0 0 1-.698.869v.001Zm8.495.005a1.86 1.86 0 0 1-2.381-.253 1.964 1.964 0 0 1-.547-1.366c0-.384.11-.76.32-1.079.207-.319.503-.567.849-.713a1.844 1.844 0 0 1 1.093-.108c.367.076.704.262.968.534a1.98 1.98 0 0 1 .4 2.117 1.932 1.932 0 0 1-.702.868Z',
  deno: 'M1.105 18.02A11.9 11.9 0 0 1 0 12.985q0-.698.078-1.376a12 12 0 0 1 .231-1.34A12 12 0 0 1 4.025 4.02a12 12 0 0 1 5.46-2.771 12 12 0 0 1 3.428-.23c1.452.112 2.825.477 4.077 1.05a12 12 0 0 1 2.78 1.774 12.02 12.02 0 0 1 4.053 7.078A12 12 0 0 1 24 12.985q0 .454-.036.914a12 12 0 0 1-.728 3.305 12 12 0 0 1-2.38 3.875c-1.33 1.357-3.02 1.962-4.43 1.936a4.4 4.4 0 0 1-2.724-1.024c-.99-.853-1.391-1.83-1.53-2.919a5 5 0 0 1 .128-1.518c.105-.38.37-1.116.76-1.437-.455-.197-1.04-.624-1.226-.829-.045-.05-.04-.13 0-.183a.155.155 0 0 1 .177-.053c.392.134.869.267 1.372.35.66.111 1.484.25 2.317.292 2.03.1 4.153-.813 4.812-2.627s.403-3.609-1.96-4.685-3.454-2.356-5.363-3.128c-1.247-.505-2.636-.205-4.06.582-3.838 2.121-7.277 8.822-5.69 15.032a.191.191 0 0 1-.315.19 12 12 0 0 1-1.25-1.634 12 12 0 0 1-.769-1.404M11.57 6.087c.649-.051 1.214.501 1.31 1.236.13.979-.228 1.99-1.41 2.013-1.01.02-1.315-.997-1.248-1.614.066-.616.574-1.575 1.35-1.635',
  typescript:
    'M1.125 0C.502 0 0 .502 0 1.125v21.75C0 23.498.502 24 1.125 24h21.75c.623 0 1.125-.502 1.125-1.125V1.125C24 .502 23.498 0 22.875 0zm17.363 9.75c.612 0 1.154.037 1.627.111a6.38 6.38 0 0 1 1.306.34v2.458a3.95 3.95 0 0 0-.643-.361 5.093 5.093 0 0 0-.717-.26 5.453 5.453 0 0 0-1.426-.2c-.3 0-.573.028-.819.086a2.1 2.1 0 0 0-.623.242c-.17.104-.3.229-.393.374a.888.888 0 0 0-.14.49c0 .196.053.373.156.529.104.156.252.304.443.444s.423.276.696.41c.273.135.582.274.926.416.47.197.892.407 1.266.628.374.222.695.473.963.753.268.279.472.598.614.957.142.359.214.776.214 1.253 0 .657-.125 1.21-.373 1.656a3.033 3.033 0 0 1-1.012 1.085 4.38 4.38 0 0 1-1.487.596c-.566.12-1.163.18-1.79.18a9.916 9.916 0 0 1-1.84-.164 5.544 5.544 0 0 1-1.512-.493v-2.63a5.033 5.033 0 0 0 3.237 1.2c.333 0 .624-.03.872-.09.249-.06.456-.144.623-.25.166-.108.29-.234.373-.38a1.023 1.023 0 0 0-.074-1.089 2.12 2.12 0 0 0-.537-.5 5.597 5.597 0 0 0-.807-.444 27.72 27.72 0 0 0-1.007-.436c-.918-.383-1.602-.852-2.053-1.405-.45-.553-.676-1.222-.676-2.005 0-.614.123-1.141.369-1.582.246-.441.58-.804 1.004-1.089a4.494 4.494 0 0 1 1.47-.629 7.536 7.536 0 0 1 1.77-.201zm-15.113.188h9.563v2.166H9.506v9.646H6.789v-9.646H3.375z',
  react:
    'M14.23 12.004a2.236 2.236 0 0 1-2.235 2.236 2.236 2.236 0 0 1-2.236-2.236 2.236 2.236 0 0 1 2.235-2.236 2.236 2.236 0 0 1 2.236 2.236zm2.648-10.69c-1.346 0-3.107.96-4.888 2.622-1.78-1.653-3.542-2.602-4.887-2.602-.41 0-.783.093-1.106.278-1.375.793-1.683 3.264-.973 6.365C1.98 8.917 0 10.42 0 12.004c0 1.59 1.99 3.097 5.043 4.03-.704 3.113-.39 5.588.988 6.38.32.187.69.275 1.102.275 1.345 0 3.107-.96 4.888-2.624 1.78 1.654 3.542 2.603 4.887 2.603.41 0 .783-.09 1.106-.275 1.374-.792 1.683-3.263.973-6.365C22.02 15.096 24 13.59 24 12.004c0-1.59-1.99-3.097-5.043-4.032.704-3.11.39-5.587-.988-6.38-.318-.184-.688-.277-1.092-.278zm-.005 1.09v.006c.225 0 .406.044.558.127.666.382.955 1.835.73 3.704-.054.46-.142.945-.25 1.44-.96-.236-2.006-.417-3.107-.534-.66-.905-1.345-1.727-2.035-2.447 1.592-1.48 3.087-2.292 4.105-2.295zm-9.77.02c1.012 0 2.514.808 4.11 2.28-.686.72-1.37 1.537-2.02 2.442-1.107.117-2.154.298-3.113.538-.112-.49-.195-.964-.254-1.42-.23-1.868.054-3.32.714-3.707.19-.09.4-.127.563-.132zm4.882 3.05c.455.468.91.992 1.36 1.564-.44-.02-.89-.034-1.345-.034-.46 0-.915.01-1.36.034.44-.572.895-1.096 1.345-1.565zM12 8.1c.74 0 1.477.034 2.202.093.406.582.802 1.203 1.183 1.86.372.64.71 1.29 1.018 1.946-.308.655-.646 1.31-1.013 1.95-.38.66-.773 1.288-1.18 1.87-.728.063-1.466.098-2.21.098-.74 0-1.477-.035-2.202-.093-.406-.582-.802-1.204-1.183-1.86-.372-.64-.71-1.29-1.018-1.946.303-.657.646-1.313 1.013-1.954.38-.66.773-1.286 1.18-1.868.728-.064 1.466-.098 2.21-.098zm-3.635.254c-.24.377-.48.763-.704 1.16-.225.39-.435.782-.635 1.174-.265-.656-.49-1.31-.676-1.947.64-.15 1.315-.283 2.015-.386zm7.26 0c.695.103 1.365.23 2.006.387-.18.632-.405 1.282-.66 1.933-.2-.39-.41-.783-.64-1.174-.225-.392-.465-.774-.705-1.146zm3.063.675c.484.15.944.317 1.375.498 1.732.74 2.852 1.708 2.852 2.476-.005.768-1.125 1.74-2.857 2.475-.42.18-.88.342-1.355.493-.28-.958-.646-1.956-1.1-2.98.45-1.017.81-2.01 1.085-2.964zm-13.395.004c.278.96.645 1.957 1.1 2.98-.45 1.017-.812 2.01-1.086 2.964-.484-.15-.944-.318-1.37-.5-1.732-.737-2.852-1.706-2.852-2.474 0-.768 1.12-1.742 2.852-2.476.42-.18.88-.342 1.356-.494zm11.678 4.28c.265.657.49 1.312.676 1.948-.64.157-1.316.29-2.016.39.24-.375.48-.762.705-1.158.225-.39.435-.788.636-1.18zm-9.945.02c.2.392.41.783.64 1.175.23.39.465.772.705 1.143-.695-.102-1.365-.23-2.006-.386.18-.63.406-1.282.66-1.933zM17.92 16.32c.112.493.2.968.254 1.423.23 1.868-.054 3.32-.714 3.708-.147.09-.338.128-.563.128-1.012 0-2.514-.807-4.11-2.28.686-.72 1.37-1.536 2.02-2.44 1.107-.118 2.154-.3 3.113-.54zm-11.83.01c.96.234 2.006.415 3.107.532.66.905 1.345 1.727 2.035 2.446-1.595 1.483-3.092 2.295-4.11 2.295-.22-.005-.406-.05-.553-.132-.666-.38-.955-1.834-.73-3.703.054-.46.142-.944.25-1.438zm4.56.64c.44.02.89.034 1.345.034.46 0 .915-.01 1.36-.034-.44.572-.895 1.095-1.345 1.565-.455-.47-.91-.993-1.36-1.565z',
}

// A brand whose mark is not one flat path in the set above: TSRX ships a
// wordmark on a gradient, and this project's own logo is strokes on a gradient.
// Both are referenced as files rather than inlined, because two inlined SVGs
// carrying a `<linearGradient id>` collide the moment they share a page.
const BRAND_IMAGES = {
  tsrx: 'brands/tsrx.svg',
  'yuku-tsrx': 'logo.svg',
}

function brandIconHtml(name) {
  const image = BRAND_IMAGES[name]
  if (image) {
    return `<img src="${withBase(`/assets/${image}`)}" alt="" width="16" height="16" loading="lazy">`
  }
  const path = BRAND_ICONS[name]
  if (!path) return ''
  return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`
}

// Package-manager tab groups repeat the same brand marks several times per
// page, and the two round marks are ~2 KiB of path data each. After a page is
// assembled, every repeated inline mark collapses to a `<use>` of one shared
// `<symbol>` appended before `</body>`, which keeps the uncompressed payload
// (what the wasm-mode perf budget measures) flat no matter how many tab groups
// a page carries. Single-occurrence marks stay inline: a symbol block would
// cost more bytes than it saves.
const BRAND_ICON_BY_PATH = new Map(Object.entries(BRAND_ICONS).map(([name, d]) => [d, name]))

function dedupeBrandIcons(html) {
  const counts = new Map()
  const pattern =
    /<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="([^"]+)"\/><\/svg>/g
  for (const [, d] of html.matchAll(pattern)) {
    const name = BRAND_ICON_BY_PATH.get(d)
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const shared = new Set([...counts].filter(([, n]) => n > 1).map(([name]) => name))
  if (shared.size === 0) return html
  const deduped = html.replace(pattern, (match, d) => {
    const name = BRAND_ICON_BY_PATH.get(d)
    if (!name || !shared.has(name)) return match
    return `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><use href="#brand-icon-${name}"/></svg>`
  })
  const symbols = [...shared]
    .map((name) => `<symbol id="brand-icon-${name}" viewBox="0 0 24 24"><path d="${BRAND_ICONS[name]}"/></symbol>`)
    .join('')
  return deduped.replace('</body>', `<svg hidden aria-hidden="true">${symbols}</svg></body>`)
}

function translateShellLine(line, pm) {
  const variant = PM_INSTALL_VARIANTS.find((entry) => line.startsWith(entry.npm))
  if (variant) return `${variant[pm]}${line.slice(variant.npm.length)}`
  if (line.startsWith('npx ')) return `${PM_EXEC_PREFIXES[pm]}${line.slice('npx'.length)}`
  return line
}

function pmInstallTabsHtml(npmCommand, groupId) {
  const lines = npmCommand.split('\n')
  if (!lines.some((line) => translateShellLine(line, 'pnpm') !== line)) {
    throw new Error(
      `pm tabs block needs a line starting with "npm install --save-dev", "npm install", or "npx", got: ${lines[0]}`,
    )
  }
  const managers = Object.keys(PM_EXEC_PREFIXES)
  const buttons = managers
    .map(
      (pm, index) =>
        `<button type="button" role="tab" id="pm-tab-${groupId}-${pm}" aria-controls="pm-panel-${groupId}-${pm}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}" data-pm="${pm}">${brandIconHtml(pm)}${pm}</button>`,
    )
    .join('')
  const panels = managers
    .map((pm, index) => {
      const command =
        pm === 'npm' ? npmCommand : lines.map((line) => translateShellLine(line, pm)).join('\n')
      return `<div role="tabpanel" id="pm-panel-${groupId}-${pm}" aria-labelledby="pm-tab-${groupId}-${pm}" data-pm="${pm}"${index === 0 ? '' : ' hidden'}><div class="code-block" data-lang="sh">${highlightHtml(command, 'sh')}</div></div>`
    })
    .join('')
  return `<div class="pm-tabs" data-pm-tabs><div class="pm-tabs-bar" role="tablist" aria-label="Package manager">${buttons}</div>${panels}</div>\n`
}

function pageMenuHtml(link) {
  const mdHref = withBase(`${link}.md`)
  const absoluteMd = `${config.origin}${mdHref}`
  const prompt = encodeURIComponent(
    `Read ${absoluteMd} so I can ask questions about this ${config.title} documentation page.`,
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

function renderDocPage({ page, article, headings, pageIndex, flat, leadWords = 0 }) {
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
  </main>
  <aside class="aside" aria-label="Page outline">${outlineHtml(headings, leadWords)}</aside>
</div>`
  return pageShell({
    title: page.title,
    description: page.description,
    pathname: page.link,
    shell: 'doc',
    bodyClass: 'doc-page',
    header: headerHtml(),
    main,
  })
}


// Headline numbers come from the committed benchmark report, read here at build
// time, so a card on the home page can never disagree with the file in the
// repository. It is one measurement on one machine, and the caption says so.
const baseline = JSON.parse(
  await readFile(path.join(repoRoot, 'benchmarks', 'm6-baseline.json'), 'utf8'),
)

function benchNumber(value) {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

// app.js drops dataset values straight into the tooltip's innerHTML, so
// anything that travels in a data- attribute is escaped twice: once for the
// attribute, once for the assignment that reads it back out.
const escapeDataset = (text) => escapeHtml(escapeHtml(text))

// The report keeps parse time in nanoseconds, which is six digits per lane and
// unreadable on a bar. Microseconds is the same measurement at a scale a reader
// can hold, and two decimals is still far finer than the run to run spread the
// report records (a MAD of about 225 ns on the yuku-tsrx lane).
const microseconds = (ns) => `${(ns / 1000).toFixed(2)} µs`

// Every figure below is derived here, from the committed report, and never
// typed in. The formulas are spelled out so a reader hovering a card can check
// the arithmetic against the JSON.
// A run the harness itself rejected is not a run this page gets to quote, so
// the build stops rather than printing a speed claim from it.
if (baseline.valid !== true) {
  throw new Error(
    'benchmarks/m6-baseline.json has valid !== true; the home page will not print figures from a rejected run',
  )
}

const nsYuku = baseline.statistics.yuku.ns_per_parse.median
const nsCore = baseline.statistics.core.ns_per_parse.median
const ppsYuku = baseline.statistics.yuku.parses_per_second.median
const ppsCore = baseline.statistics.core.parses_per_second.median
const bpsYuku = baseline.statistics.yuku.bytes_per_second.median
const bpsCore = baseline.statistics.core.bytes_per_second.median
const rssYuku = baseline.statistics.yuku.peak_rss_bytes.median
const rssCore = baseline.statistics.core.peak_rss_bytes.median
const speedup = nsCore / nsYuku
const memorySaved = (1 - baseline.ratios.peak_rss) * 100
// MB here is 1,000,000 bytes, the unit the report itself uses; the caption says
// so rather than leaving a reader to guess between that and 1,048,576.
const megabytes = (bytes) => (bytes / 1e6).toFixed(1)

function homeBenchCards() {
  const cards = [
    {
      // The report states the ratio the slow way round, and a reader wants the
      // multiple, not the fraction.
      valueHtml: `${speedup.toFixed(2)}&times;`,
      valueText: `${speedup.toFixed(2)}x`,
      label: 'faster median parse than @tsrx/core',
      budget: `${benchNumber(nsYuku)} ns vs ${benchNumber(nsCore)} ns per parse`,
      note: `statistics.core.ns_per_parse.median divided by statistics.yuku.ns_per_parse.median: ${microseconds(nsCore)} against ${microseconds(nsYuku)} per parse.`,
    },
    {
      valueHtml: `${benchNumber(ppsYuku)} parses/s`,
      valueText: `${benchNumber(ppsYuku)} parses per second`,
      label: 'median parses per second',
      budget: `@tsrx/core: ${benchNumber(ppsCore)} parses/s`,
      note: 'statistics.yuku.parses_per_second.median against statistics.core.parses_per_second.median, over the whole corpus.',
    },
    {
      valueHtml: `${megabytes(bpsYuku)} MB/s`,
      valueText: `${megabytes(bpsYuku)} megabytes per second`,
      label: 'source parsed per second',
      budget: `@tsrx/core: ${megabytes(bpsCore)} MB/s`,
      note: 'statistics.yuku.bytes_per_second.median divided by 1,000,000, against the same field for @tsrx/core.',
    },
    {
      valueHtml: `${Math.round(memorySaved)}% less`,
      valueText: `${Math.round(memorySaved)} percent less`,
      label: 'peak memory than @tsrx/core',
      budget: `${megabytes(rssYuku)} MB vs ${megabytes(rssCore)} MB peak RSS`,
      note: '(1 - ratios.peak_rss) * 100, measured as the whole child process maximum resident set size.',
    },
  ]
  return `<div class="gate-grid" role="group" aria-label="Headline figures derived from the committed benchmark report">${cards
    .map(
      (card) => `
  <div class="bench-row gate-card" role="img" aria-label="${escapeHtml(`${card.valueText} ${card.label}, ${card.budget}`)}"
     data-label="${escapeDataset(card.valueText)}" data-result="${escapeDataset(card.label)}" data-note="${escapeDataset(card.note)}">
    <span class="gate-value">${card.valueHtml}</span>
    <span class="gate-label">${escapeHtml(card.label)}</span>
    <span class="gate-budget">${escapeHtml(card.budget)}</span>
  </div>`,
    )
    .join('')}</div>`
}

// The two lanes of the comparison chart. Bar length is absolute time, so the
// slowest lane fills the track and every other lane is read against it:
// shorter is faster, with no axis to decode. fuel.js paints a WebGL plume into
// each track once the chart scrolls up; these gradients are what ships without
// it, and what a reader who asked for reduced motion keeps.
function homeCompChart() {
  const lanes = [
    {
      key: 'yukuTsrx',
      name: 'yuku-tsrx',
      ns: nsYuku,
      ours: true,
      note: `The dialect parser in this repository, parsing the whole ${benchNumber(baseline.input.file_count)}-file corpus ${baseline.protocol.iterations} times per sample.`,
    },
    {
      key: 'tsrxCore',
      name: '@tsrx/core',
      ns: nsCore,
      ours: false,
      note: 'The published reference parser, run on the same bytes in the same child process shape, with the run order alternating between the two across samples.',
    },
  ]
  const slowest = Math.max(...lanes.map((lane) => lane.ns))
  const rows = lanes
    .map((lane) => {
      const widthPct = Math.max((lane.ns / slowest) * 100, 0.8)
      const label = microseconds(lane.ns)
      return `
  <div class="bench-row comp-row${lane.ours ? ' comp-ours' : ''}" tabindex="0" role="img" aria-label="${escapeHtml(`${lane.name}: ${label} median per parse`)}"
     data-key="${lane.key}" data-label="${escapeDataset(lane.name)}" data-result="${escapeDataset(`${label} median per parse`)}"
     data-note="${escapeDataset(lane.note)}">
    <span class="comp-head"><span class="comp-name">${escapeHtml(lane.name)}</span><span class="comp-time">${escapeHtml(label)}</span></span>
    <span class="comp-track"><span class="bench-bar comp-fill" style="width:${widthPct.toFixed(1)}%"></span></span>
  </div>`
    })
    .join('')
  return `<div class="comp-chart" role="group" aria-label="Median parse time for the two parsers on one matched corpus. Shorter bars are faster.">${rows}
</div>
<p class="home-bench-caption">Shorter is faster. Median microseconds per parse of the same ${benchNumber(baseline.input.bytes)}-byte input, ${baseline.protocol.iterations} iterations, alternating order.</p>`
}

// ---------- the in-browser dialect (wasm) ----------
// The module is built by `pnpm run docs:wasm`; this build never invokes zig, it
// only ships what is already there. The two decoders travel with it, because
// the wire format between them and the module is only guaranteed within one
// tree.
const wasmPath = process.env.YUKU_TSRX_WASM
  ? path.resolve(process.env.YUKU_TSRX_WASM)
  : path.join(repoRoot, 'zig-out', 'wasm', 'yuku-tsrx.wasm')

// The module is a zig artifact this build cannot produce, so it is only shipped
// when the stamp tools/build-wasm.mjs wrote beside it names the src/ tree at
// HEAD. A stale binary would run the playground on code the docs no longer
// describe, silently.
async function requireFreshWasm() {
  const stamp = await readStamp(wasmPath)
  const relative = path.relative(repoRoot, stampPathFor(wasmPath))
  const current = srcTree()
  if (!stamp) {
    throw new Error(`missing ${relative}: run \`pnpm run docs:wasm\` to build and stamp the wasm module`)
  }
  if (stamp.tree !== current.tree) {
    throw new Error(
      `${path.relative(repoRoot, wasmPath)} was built from src/ tree ${stamp.tree.slice(0, 12)}, but HEAD:src is ${current.tree.slice(0, 12)}: run \`pnpm run docs:wasm\``,
    )
  }
  const dirty = [
    ...(stamp.dirty ? [`${path.relative(repoRoot, wasmPath)} was built from an uncommitted src/`] : []),
    ...(current.dirty ? ['src/ has uncommitted changes'] : []),
  ]
  if (dirty.length > 0 && !process.argv.includes('--allow-dirty')) {
    throw new Error(`${dirty.join('; ')}: pass \`--allow-dirty\` to build anyway`)
  }
  return stamp
}

async function copyWasmAssets() {
  const outWasmDir = path.join(siteDir, 'assets', 'wasm')
  await mkdir(outWasmDir, { recursive: true })
  let wasm
  try {
    wasm = await readFile(wasmPath)
  } catch {
    throw new Error(
      `missing ${path.relative(repoRoot, wasmPath)}: run pnpm docs:wasm first`,
    )
  }
  await writeFile(path.join(outWasmDir, 'yuku-tsrx.wasm'), wasm)
  for (const name of ['decode.js', 'decode-analyzer.js']) {
    await cp(path.join(repoRoot, 'npm', 'yuku', name), path.join(outWasmDir, name))
  }
  return wasm.length
}

// The playground's example buttons carry committed parser fixtures, inlined
// here so the page needs no second request to show one. A missing fixture is a
// build failure rather than a button that does nothing.
const FIXTURES = [
  { id: 'code-block', label: 'Code block', file: 'code-block.module.tsrx' },
  { id: 'control-flow-if', label: 'If / else', file: 'control-flow-if.module.tsrx' },
  { id: 'control-flow-for', label: 'For', file: 'control-flow-for.module.tsrx' },
  { id: 'control-flow-switch', label: 'Switch', file: 'control-flow-switch.module.tsrx' },
  { id: 'dynamic-tag', label: 'Dynamic tag', file: 'dynamic-tag.module.tsrx' },
  { id: 'style-element', label: 'Style element', file: 'style-element.module.tsrx' },
  {
    id: 'control-flow-switch-invalid',
    label: 'Invalid switch',
    file: 'control-flow-switch-invalid.module.tsrx',
  },
]

async function readFixtures() {
  const dir = path.join(repoRoot, 'test', 'parser', 'misc', 'tsrx')
  const entries = {}
  for (const fixture of FIXTURES) {
    const file = path.join(dir, fixture.file)
    let source
    try {
      source = await readFile(file, 'utf8')
    } catch {
      throw new Error(`missing playground fixture ${path.relative(repoRoot, file)}`)
    }
    entries[fixture.id] = {
      source,
      note: `test/parser/misc/tsrx/${fixture.file}, parsed here by the same dialect the test suite uses.`,
    }
  }
  return entries
}

const PLAYGROUND_ROUTE = config.playground ?? '/playground'

const PLAYGROUND_IDLE_NOTE =
  'Pick a committed parser fixture, or type your own TSRX. Everything below is produced in this tab.'

// The four output tabs. app.js already carries the delegated `[data-explorer]`
// tab handling, so the markup is all the wiring they need.
function outputPanelHtml() {
  const tabs = [
    ['ast', 'AST', 'The decoded program, as JSON. TSRX nodes keep their own names: JSXCodeBlock, TSRXExpression, JSXStyleElement.'],
    ['diagnostics', 'Diagnostics', 'Everything the parser reported for the current source, including the semantic early errors.'],
    ['generated', 'Generated code', 'What the code generator prints for the current program.'],
    ['semantic', 'Semantic', 'Scopes, symbols, references and the module record from the analyzer.'],
  ]
  return `<div class="code-panel pg-output" id="pg-output" data-explorer>
        <div class="code-panel-bar pg-output-tabs" role="tablist" aria-label="Parser output">
          <span class="pg-pane-label" aria-hidden="true">Output</span>
          ${tabs
            .map(
              ([id, label], index) =>
                `<button type="button" role="tab" id="pg-tab-${id}" aria-controls="pg-panel-${id}" aria-selected="${index === 0}"${
                  index === 0 ? '' : ' tabindex="-1"'
                }>${label}</button>`,
            )
            .join('\n          ')}
        </div>
        <div class="pg-output-body">
          ${tabs
            .map(
              ([id, label, note], index) =>
                `<div role="tabpanel" id="pg-panel-${id}" aria-labelledby="pg-tab-${id}"${
                  index === 0 ? '' : ' hidden'
                }><p class="pg-note pg-output-note">${note}</p><div class="pg-output-code" id="pg-${id}"></div></div>`,
            )
            .join('\n          ')}
        </div>
        <div class="code-panel-status"><span id="pg-output-status">the parser starts when this page loads</span></div>
      </div>`
}

function renderPlaygroundPage(fixtures) {
  const buttons = FIXTURES.map(
    (fixture) =>
      `<button type="button" class="demo-button" id="pg-scenario-${fixture.id}" data-scenario="${fixture.id}">${escapeHtml(fixture.label)}</button>`,
  ).join('\n          ')
  // Inlined as JSON rather than as attributes: the fixtures are whole files,
  // and `<` is escaped so the payload can never close its own script element.
  const fixturesJson = JSON.stringify(fixtures).replaceAll('<', '\\u003c')
  const main = `
<main id="main-content" class="home playground-page">
  <section class="pg" aria-label="Playground">
    <header class="pg-topbar">
      <h1 class="pg-title">TSRX Playground</h1>
      <p class="pg-tagline">Real yuku-tsrx, compiled to WebAssembly, running in this tab: parse, analyze, generate.</p>
    </header>
    <div class="pg-toolbar pg-examples-bar" id="pg-side">
      <div class="pg-examples" role="group" aria-label="Committed parser fixtures">
        <span class="pg-examples-label" id="pg-engine-label">Examples</span>
        ${buttons}
      </div>
      <p class="pg-note" id="pg-scenario-note" role="status" data-idle="${escapeHtml(PLAYGROUND_IDLE_NOTE)}">${escapeHtml(PLAYGROUND_IDLE_NOTE)}</p>
    </div>
    <div class="pg-panes">
      <div class="code-panel pg-panel" id="hero-demo">
        <div class="code-panel-bar">
          <span class="code-panel-dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <span class="code-panel-file">playground.tsrx</span>
          <span class="code-panel-hint" id="demo-hint"></span>
          <span class="code-panel-actions" id="demo-actions" hidden>
            <button type="button" class="demo-button" id="demo-share">Share</button>
            <button type="button" class="demo-button" id="demo-reset">Reset</button>
          </span>
        </div>
        <div class="code-panel-editor" id="demo-editor">
          ${addTsrxHovers(highlightHtml(heroCode, 'tsrx'))}
        </div>
        <div class="code-panel-status">
          <span id="demo-status" aria-live="polite">a TSRX component, highlighted with the TSRX grammar</span>
          <span id="demo-meta">tsx · module</span>
        </div>
      </div>
      ${outputPanelHtml()}
    </div>
  </section>
  <script type="application/json" id="pg-fixtures">${fixturesJson}</script>
</main>`
  return pageShell({
    title: 'Playground',
    description:
      'Edit TSRX and watch the real yuku-tsrx parser, analyzer and code generator answer in your browser, compiled to WebAssembly.',
    pathname: PLAYGROUND_ROUTE,
    shell: 'playground',
    bodyClass: 'home-page',
    header: headerHtml(),
    main,
  })
}

async function renderHomePage({ description }) {
  const hero = config.hero
  const main = `
<main id="main-content" class="home">
  <section class="hero">
    <img class="hero-logo" src="${withBase('/assets/logo.svg')}" alt="" width="64" height="64" />
    <h1 class="hero-name">${hero.name}</h1>
    <p class="hero-text">${hero.text}</p>
    <p class="hero-tagline">${hero.tagline}</p>
    <div class="hero-actions">
      ${hero.actions
        .map(
          (action) =>
            `<a class="action action-${action.theme}" href="${withBase(action.link)}">${action.text}</a>`,
        )
        .join('\n')}
    </div>
  </section>
  <section class="band" aria-label="TSRX example">
    <div class="pg-panes hero-panes">
    <div class="code-panel pg-panel" id="hero-demo">
      <div class="code-panel-bar">
        <span class="code-panel-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="code-panel-file">src/Cart.tsrx</span>
        <span class="code-panel-hint" id="demo-hint"></span>
        <span class="code-panel-actions" id="demo-actions" hidden>
          <button type="button" class="demo-button" id="demo-reset">Reset</button>
          <button type="button" class="demo-button" id="demo-open">Open in playground</button>
        </span>
      </div>
      <div class="code-panel-editor" id="demo-editor">
        ${addTsrxHovers(highlightHtml(heroCode, 'tsrx'))}
      </div>
      <div class="code-panel-status">
        <span id="demo-status" aria-live="polite">a TSRX component, highlighted with the TSRX grammar</span>
        <span id="demo-meta">tsx · module</span>
      </div>
    </div>
    ${outputPanelHtml()}
    </div>
  </section>
  <section class="home-bench" aria-label="Measured parse time">
    <h2>Measured, not claimed</h2>
    <p>These four numbers are computed from <code>benchmarks/m6-baseline.json</code> when this page is built, so they cannot drift from the committed report.</p>
    ${homeBenchCards()}
    ${homeCompChart()}
    <p class="home-bench-caption" title="MB means 1,000,000 bytes here, the unit the report uses.">One measurement on one machine (${escapeHtml(baseline.provenance.runtime.cpu)}, a ${benchNumber(baseline.input.file_count)}-file corpus). Your hardware will differ. MB means 1,000,000 bytes.</p>
    <p class="home-bench-link"><a href="${withBase('/reference/benchmarks')}">See the report and its caveats</a></p>
  </section>
  <section class="features" aria-label="Feature highlights">
    <ul class="features-grid">
      ${config.features
        .map(
          (feature) => `
      <li class="feature">
        <span class="feature-icon">${feature.icon}</span>
        <h2 class="feature-title">${feature.title}</h2>
        <p class="feature-details">${feature.details}</p>
      </li>`,
        )
        .join('\n')}
    </ul>
  </section>
  <footer class="home-footer">
    <p class="footer-links"><a href="${config.repository}" target="_blank" rel="noreferrer">GitHub<span class="visually-hidden"> (opens in new tab)</span></a></p>
${config.footer.copyright ? `    <p class="footer-badge">${escapeHtml(config.footer.copyright)}</p>\n` : ''}  </footer>
</main>`
  return pageShell({
    title: config.title,
    description,
    pathname: '/',
    shell: 'home',
    bodyClass: 'home-page',
    header: headerHtml(),
    main,
  })
}

async function buildRedirectOnly() {
  await validateOutputDirectory()
  await rm(outDir, { recursive: true, force: true })
  await mkdir(outDir, { recursive: true })
  const redirects = legacyRedirects()
  await writeFile(
    path.join(outDir, 'vercel.json'),
    `${JSON.stringify({ cleanUrls: true, trailingSlash: false, redirects, rewrites: [], headers: [] })}\n`,
  )
  // Only reached by a path the redirects do not cover, so it points the way.
  await writeFile(
    path.join(outDir, 'index.html'),
    `<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0; url=${config.redirectTo}/">\n<title>${escapeHtml(config.title)}</title>\n<p>Moved to <a href="${config.redirectTo}/">${config.redirectTo}</a>.</p>\n`,
  )
  await writeFile(path.join(outDir, 'robots.txt'), 'User-agent: *\nDisallow: /\n')
  console.log(`wrote a redirect-only site: ${trimmedBase || '/'} -> ${config.redirectTo}/ (${redirects.length} rules) -> ${outDir}`)
}

async function build() {
  if (redirectOnly) return buildRedirectOnly()
  await validateOutputDirectory()
  const wasmStamp = await requireFreshWasm()
  await rm(outDir, { recursive: true, force: true })
  await mkdir(siteDir, { recursive: true })

  const flat = config.sidebar.flatMap((group) =>
    group.items.map((item) => ({ ...item, group: group.text })),
  )
  const pages = [...flat]
  const claimed = new Set(
    pages.map((page) => path.join(docsDir, `${page.link.replace(/^\//, '')}.md`)),
  )
  const sectionDirs = new Set(pages.map((page) => page.link.split('/')[1]))
  const unlisted = []
  for (const section of sectionDirs) {
    for (const file of await readdir(path.join(docsDir, section), { recursive: true })) {
      const sourcePath = path.join(docsDir, section, file)
      if (!file.endsWith('.md') || claimed.has(sourcePath)) continue
      const { data } = parseFrontmatter(await readFile(sourcePath, 'utf8'))
      if (data.unlisted !== 'true') unlisted.push(path.relative(docsDir, sourcePath))
    }
  }
  if (unlisted.length > 0) {
    throw new Error(`markdown pages missing from the sidebar: ${unlisted.sort().join(', ')}`)
  }
  const searchDocs = []

  const markdownPages = []
  for (const [pageIndex, item] of pages.entries()) {
    const sourcePath = path.join(docsDir, `${item.link.replace(/^\//, '')}.md`)
    const source = await readFile(sourcePath, 'utf8')
    const { data, body: sourceBody } = parseFrontmatter(source)
    const pmInstallBlocks = []
    const body = sourceBody.replace(PM_TABS_PATTERN, (_match, command) => {
      pmInstallBlocks.push(command)
      return `<!-- pm-tabs:${pmInstallBlocks.length - 1} -->`
    })
    let exportedBody = sourceBody.replace(/<!-- pm-(?:install|exec) -->\r?\n/g, '')
    const page = {
      link: item.link,
      group: item.group,
      title: data.title || item.text,
      description: data.description || '',
    }
    const headings = []
    const nodeChips = body.includes(NODE_CHIPS_MARKER)
      ? await nodeChipEntries(body, sourcePath)
      : null
    const marked = createMarked(makeSlugger(), headings, nodeChips)
    let article = marked.parse(body)
    article = article
      .replaceAll('<table>', '<div class="table-wrap"><table>')
      .replaceAll('</table>', '</table></div>')
      // A markdown table that opens its header row with a blank cell is a
      // cross-tab: the first column carries row labels, so it has no column
      // name to print. Marked still emits `<th></th>` for it, and a header
      // cell with no accessible text is a header that announces nothing, which
      // axe flags as empty-table-header. The corner cell of a cross-tab is a
      // plain `td` in the HTML spec's own example, so emit that instead.
      .replace(/<th([^>]*)>\s*<\/th>/g, '<td$1></td>')
    if (article.includes('<!-- details:')) {
      article = disclosureHtml(article)
      exportedBody = disclosureMarkdown(exportedBody)
    }
    if (hasGuideFigure(body)) {
      const figureSources = collectFigureSources(body, sourcePath)
      article = renderGuideFigures(article, figureSources, sourcePath)
      exportedBody = guideFigureMarkdown(exportedBody)
    }
    if (article.includes('<!-- how-it-works -->')) {
      article = article.replace('<!-- how-it-works -->', await howItWorksHtml())
      exportedBody = exportedBody.replace('<!-- how-it-works -->', await howItWorksMarkdown())
    }
    TERMINAL_DEMO_MARKER.lastIndex = 0
    for (const match of [...article.matchAll(TERMINAL_DEMO_MARKER)]) {
      const demo = await loadTranscript(match[1])
      article = article.replace(match[0], terminalDemoHtml(demo, match[1]))
      exportedBody = exportedBody.replace(match[0], terminalDemoMarkdown(demo))
    }
    if (article.includes('<!-- chooser -->')) {
      article = chooserHtml(article)
      exportedBody = exportedBody.replace('<!-- chooser -->', chooserTwin)
    }
    if (nodeChips) {
      article = article.replace(NODE_CHIPS_MARKER, `<p class="node-chips-note">${NODE_CHIPS_NOTE}</p>`)
      exportedBody = nodeChipsMarkdown(exportedBody, nodeChips)
    }
    if (article.includes('<!-- hook-matrix -->')) {
      article = hookMatrixHtml(article, (await readHooks()).hooks, sourcePath)
      exportedBody = exportedBody.replace('<!-- hook-matrix -->', hookMatrixTwin)
    }
    const widgets = collectWidgets(body, sourcePath)
    if (widgets.length > 0) {
      article = await renderWidgets(article, widgets, page)
      exportedBody = await widgetsMarkdown(exportedBody, widgets, page)
    }
    for (const [index, command] of pmInstallBlocks.entries()) {
      article = article.replace(`<!-- pm-tabs:${index} -->`, pmInstallTabsHtml(command, index))
    }
    article = addGlossary(article)
    searchDocs.push(...extractSections(new Marked(), exportedBody, page))
    const leadWords = annotateReadingTime(article, headings)
    const html = renderDocPage({
      page,
      article,
      headings,
      leadWords,
      pageIndex,
      flat,
    })
    const outPath = path.join(siteDir, `${item.link.replace(/^\//, '')}.html`)
    await mkdir(path.dirname(outPath), { recursive: true })
    await writeFile(outPath, dedupeBrandIcons(html))
    // Raw markdown twin for the copy-as-Markdown button and llms-full.txt.
    await writeFile(outPath.replace(/\.html$/, '.md'), exportedBody)
    markdownPages.push({ ...page, body: exportedBody })
  }

  // llms.txt index and llms-full.txt corpus (https://llmstxt.org).
  const llmsIndex = [
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
          return `- [${item.text}](${withBase(`${item.link}.md`)})${page?.description ? `: ${page.description}` : ''}`
        }),
        '',
      ].join('\n'),
    ),
  ].join('\n')
  await writeFile(path.join(siteDir, 'llms.txt'), llmsIndex)
  await writeFile(
    path.join(siteDir, 'llms-full.txt'),
    markdownPages
      .map((page) => `<!-- ${page.group} / ${page.title} (${page.link}) -->\n\n${page.body}`)
      .join('\n\n---\n\n'),
  )

  const home = parseFrontmatter(await readFile(path.join(docsDir, 'index.md'), 'utf8'))
  await writeFile(
    path.join(siteDir, 'index.html'),
    dedupeBrandIcons(await renderHomePage({ description: home.data.description })),
  )
  await writeFile(
    path.join(siteDir, `${PLAYGROUND_ROUTE.replace(/^\//, '')}.html`),
    dedupeBrandIcons(renderPlaygroundPage(await readFixtures())),
  )

  await cp(path.join(docsDir, 'assets'), path.join(siteDir, 'assets'), { recursive: true })
  await rolldownBuild({
    input: path.join(docsDir, 'demo-highlighter-entry.mjs'),
    platform: 'browser',
    output: {
      format: 'esm',
      file: path.join(siteDir, 'assets', 'demo-highlighter.js'),
      minify: true,
    },
  })
  // fuel.js is fetched by app.js only when the home comparison chart scrolls
  // up, so nothing here links it and nothing would fail loudly if the copy
  // above ever stopped reaching it. Copy it by name and let a missing file
  // break the build rather than the page.
  await cp(
    path.join(docsDir, 'assets', 'fuel.js'),
    path.join(siteDir, 'assets', 'fuel.js'),
  )
  const wasmBytes = await copyWasmAssets()
  // Ship one stylesheet per page shell, without comments (the source keeps
  // them). Every byte here is on the critical path of the page that links it,
  // so a page gets the rules it can match and nothing else.
  //
  // The unsplit stylesheet still ships, at the path it has always had, and it is
  // deliberately not linked by anything this build emits. It is here for the
  // documents that were served BEFORE the split, which link
  // `/assets/style.css`.
  await writeFile(
    path.join(siteDir, 'assets', 'style.css'),
    styleSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\n{3,}/g, '\n\n'),
  )
  // A widget's own rules live beside its runtime half as docs/assets/widgets/NAME.css
  // and travel with every shell, so a page writer never edits style.css.
  const widgetCssFiles = (await readdir(widgetRuntimeDir)).filter((f) => f.endsWith('.css')).sort()
  const widgetCss = (
    await Promise.all(widgetCssFiles.map((f) => readFile(path.join(widgetRuntimeDir, f), 'utf8')))
  ).join('\n')
  for (const [shell, lines] of styleBundles) {
    await writeFile(
      path.join(siteDir, 'assets', `style-${shell}.css`),
      [...lines, widgetCss]
        .join('\n')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\n{3,}/g, '\n\n'),
    )
  }
  await cp(
    path.join(repoRoot, 'node_modules', 'minisearch', 'dist', 'es'),
    path.join(siteDir, 'assets', 'minisearch'),
    { recursive: true },
  )
  await writeFile(path.join(siteDir, 'search-index.json'), JSON.stringify(searchDocs))
  // Site navigation links are extensionless (/guide/parse); Vercel needs
  // cleanUrls to resolve them to the .html files. The deploy root itself is not
  // part of the site, so it redirects into the base path. Every retired route
  // in config.redirects, and its .md twin, redirects permanently to a route
  // this build wrote.
  const publicPaths = ['/', PLAYGROUND_ROUTE, ...pages.map(({ link }) => link)]
  const retired = Object.entries(REDIRECTS).flatMap(([from, to]) => {
    if (!publicPaths.includes(to)) {
      throw new Error(`site.config.mjs redirects ${from} to ${to}, which this build did not write`)
    }
    if (publicPaths.includes(from)) {
      throw new Error(`site.config.mjs redirects ${from}, which is still a page`)
    }
    const twin = pages.some(({ link }) => link === to) ? [[`${from}.md`, `${to}.md`]] : []
    return [[from, to], ...twin].map(([source, destination]) => ({
      source: withBase(source),
      destination: withBase(destination),
      permanent: true,
    }))
  })
  await writeFile(
    path.join(outDir, 'vercel.json'),
    `${JSON.stringify({
      cleanUrls: true,
      trailingSlash: false,
      // Vercel applies redirects before the filesystem, so on a legacy build
      // the pages still written under the base stop being reachable there.
      redirects: [
        ...(trimmedBase ? [{ source: '/', destination: trimmedBase, permanent: false }] : []),
        ...legacyRedirects(),
        ...retired,
      ],
      rewrites: [],
      headers: [],
    })}\n`,
  )

  await writeFile(
    path.join(outDir, 'robots.txt'),
    `User-agent: *\nAllow: ${base}\nSitemap: ${canonicalUrl('/sitemap.xml')}\n`,
  )
  await writeFile(
    path.join(siteDir, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${publicPaths
      .map((pathname) => `  <url><loc>${canonicalUrl(pathname)}</loc></url>`)
      .join('\n')}\n</urlset>\n`,
  )

  console.log(
    `built ${publicPaths.length} pages, ${searchDocs.length} search sections, ` +
      `${(wasmBytes / 1024).toFixed(0)} KiB of wasm (built ${wasmStamp.built_at}) -> ${outDir}`,
  )
}

await build()
