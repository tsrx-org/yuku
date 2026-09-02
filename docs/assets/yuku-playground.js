// The interactive editor behind the home-page hero panel and /playground.
//
// Everything it shows comes from docs/assets/yuku-wasm.js, which is the real
// yuku-tsrx dialect compiled to WebAssembly and running in this tab: the AST,
// the diagnostics, the generated source and the semantic tables. There is no
// pre-computed output anywhere in this file. If the module cannot start, the
// panel says so and stays a read-only listing.

import { analyze, generate, parse, ready, symbolFlags } from './yuku-wasm.js'
import {
  byteToCharIndex,
  escapeHtml,
  flagNames,
  formatMs,
  plural,
} from './yuku-shared.js'
import { highlightedHtml } from './widgets/_shared.js'

// ---- URL-hash sharing ----
const b64uEncode = (text) => {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}
const b64uDecode = (encoded) => {
  const binary = atob(encoded.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

const LANGS = ['js', 'ts', 'jsx', 'tsx', 'dts']
const SOURCE_TYPES = ['script', 'module', 'commonjs']

function readShareHash() {
  const params = new URLSearchParams(location.hash.slice(1))
  const state = {}
  try {
    if (params.get('code')) state.code = b64uDecode(params.get('code'))
  } catch {}
  if (LANGS.includes(params.get('lang'))) state.lang = params.get('lang')
  if (SOURCE_TYPES.includes(params.get('src'))) state.sourceType = params.get('src')
  return state
}

// A very large program serialises to tens of megabytes of JSON, which is a tab
// nobody can read and a main thread nobody gets back. Cut it and say so.
const AST_LIMIT = 200_000
const jsonReplacer = (_key, value) => (typeof value === 'bigint' ? `${value}n` : value)

const playgroundHref = () =>
  document.querySelector('.top-nav a[href$="/playground"]')?.getAttribute('href') ?? '/playground'

export async function initDemo(panel) {
  const editor = panel.querySelector('#demo-editor')
  const pre = editor?.querySelector('pre')
  const codeEl = pre?.querySelector('code')
  const statusEl = panel.querySelector('#demo-status')
  if (!editor || !pre || !codeEl || !statusEl) return () => {}

  const metaEl = panel.querySelector('#demo-meta')
  const hintEl = panel.querySelector('#demo-hint')
  const actions = panel.querySelector('#demo-actions')
  const outputPanel = document.getElementById('pg-output')
  const outputStatus = document.getElementById('pg-output-status')
  const scenarioNote = document.getElementById('pg-scenario-note')
  const original = pre.textContent

  // In the /playground workbench the output pane scrolls inside its own grid
  // cell. On the home page the panel sits in the flow of a landing page, where
  // an unbounded AST dump would make the page kilometres long, so it gets its
  // own scroll region. Set here rather than in the stylesheet because the panel
  // only ever has content once this module has filled it.
  const outputBody = outputPanel?.querySelector('.pg-output-body')
  if (outputBody && !outputPanel.closest('.pg-panes')) outputBody.style.maxHeight = '60vh'

  let disposed = false
  let parseTimer = null
  let idleTimer = null
  const windowListeners = []
  const onWindow = (type, handler, options) => {
    window.addEventListener(type, handler, options)
    windowListeners.push([type, handler])
  }
  const cleanup = () => {
    disposed = true
    clearTimeout(parseTimer)
    clearTimeout(idleTimer)
    for (const [type, handler] of windowListeners) window.removeEventListener(type, handler)
    windowListeners.length = 0
  }

  const setStatus = (text, tone = 'ok') => {
    statusEl.textContent = text
    statusEl.dataset.tone = tone
  }

  const shared = readShareHash()
  const options = {
    lang: shared.lang ?? 'tsx',
    sourceType: shared.sourceType ?? 'module',
    semanticErrors: true,
  }
  if (metaEl) metaEl.textContent = `${options.lang} · ${options.sourceType}`

  setStatus('loading the in-browser parser...')
  try {
    await ready()
  } catch (error) {
    setStatus('in-browser parser unavailable', 'error')
    if (hintEl) hintEl.textContent = 'read only'
    if (outputStatus) outputStatus.textContent = `in-browser parser unavailable: ${error.message}`
    return cleanup
  }
  if (disposed) return cleanup

  // ---- measurements taken from the server-rendered listing ----
  const preStyle = getComputedStyle(pre)
  const lineHeight = Number.parseFloat(preStyle.lineHeight)
  const padTop = Number.parseFloat(preStyle.paddingTop)
  const firstToken = codeEl.querySelector('.line > span')
  const gutterX = firstToken
    ? firstToken.getBoundingClientRect().left - pre.getBoundingClientRect().left
    : Number.parseFloat(preStyle.paddingLeft)
  const probe = document.createElement('span')
  probe.textContent = 'M'.repeat(20)
  probe.style.position = 'absolute'
  probe.style.visibility = 'hidden'
  codeEl.appendChild(probe)
  const charWidth = probe.getBoundingClientRect().width / 20
  probe.remove()

  // ---- overlay construction: a transparent textarea over the highlighted pre ----
  editor.classList.add('demo-active')
  pre.removeAttribute('tabindex')
  // The mirror is visual only once the editable control exists; exposing both
  // would have assistive technology read the source twice.
  pre.setAttribute('aria-hidden', 'true')
  const diagLayer = document.createElement('div')
  diagLayer.className = 'demo-diags'
  diagLayer.setAttribute('aria-hidden', 'true')
  const textarea = document.createElement('textarea')
  textarea.className = 'demo-input'
  textarea.id = 'demo-input'
  textarea.value = original
  textarea.wrap = 'off'
  textarea.spellcheck = false
  textarea.autocapitalize = 'off'
  textarea.autocomplete = 'off'
  textarea.setAttribute('aria-label', 'Editable TSRX source')
  const escapeNote = document.createElement('span')
  escapeNote.className = 'visually-hidden'
  escapeNote.id = 'demo-escape-note'
  escapeNote.textContent = 'Tab indents code inside this editor. Press Escape to move focus out.'
  textarea.setAttribute('aria-describedby', escapeNote.id)
  for (const [property, value] of [
    ['fontFamily', preStyle.fontFamily],
    ['fontSize', preStyle.fontSize],
    ['lineHeight', preStyle.lineHeight],
    ['paddingTop', `${padTop}px`],
    ['paddingLeft', `${gutterX}px`],
    ['paddingRight', preStyle.paddingRight],
    ['paddingBottom', preStyle.paddingBottom],
  ]) {
    textarea.style[property] = value
  }
  const tooltip = document.createElement('div')
  tooltip.className = 'demo-tooltip'
  tooltip.setAttribute('role', 'tooltip')
  tooltip.hidden = true
  const srDiagnostics = document.createElement('ul')
  srDiagnostics.className = 'visually-hidden'
  srDiagnostics.setAttribute('aria-label', 'Current parser diagnostics')
  editor.append(diagLayer, textarea)
  panel.append(tooltip, srDiagnostics, escapeNote)
  if (actions) actions.hidden = false
  if (hintEl) hintEl.textContent = 'edit me · runs in your browser'

  // In the /playground workbench the editor fills its pane and scrolls inside
  // it; on the home page it grows with its content instead.
  const fillMode = Boolean(editor.closest('.pg-panes'))
  const syncSize = () => {
    if (fillMode) {
      textarea.style.height = '100%'
      textarea.style.overflowY = 'auto'
      return
    }
    textarea.style.height = `${pre.offsetHeight}px`
    editor.style.height = `${pre.offsetHeight}px`
  }
  syncSize()
  const hideTooltip = () => {
    tooltip.hidden = true
  }
  textarea.addEventListener('scroll', () => {
    const shift = `translate(${-textarea.scrollLeft}px, ${-textarea.scrollTop}px)`
    pre.style.transform = shift
    diagLayer.style.transform = shift
    hideTooltip()
  })

  let mirrorTicket = 0
  const renderEditor = async (text) => {
    const ticket = ++mirrorTicket
    const rendered = document.createElement('div')
    rendered.innerHTML = await highlightedHtml(text, '', 'tsrx')
    if (ticket !== mirrorTicket || disposed) return
    codeEl.innerHTML = rendered.querySelector('code').innerHTML
    syncSize()
  }

  // ---- diagnostic underlines and their hover tooltip ----
  let segments = []
  const clearDiagnostics = () => {
    diagLayer.innerHTML = ''
    srDiagnostics.innerHTML = ''
    segments = []
  }

  const renderMarkers = (text, diagnostics) => {
    clearDiagnostics()
    for (const diagnostic of diagnostics) {
      const spans = diagnostic.labels?.length
        ? diagnostic.labels.map((label) => [label.start, label.end, label.message])
        : [[diagnostic.start, diagnostic.end, '']]
      for (const [start, end, label] of spans) {
        const before = text.slice(0, start)
        const line = (before.match(/\n/g) ?? []).length
        const col = start - (before.lastIndexOf('\n') + 1)
        const lineEnd = text.indexOf('\n', start)
        const clampedEnd = lineEnd === -1 ? end : Math.min(end, lineEnd)
        const segment = {
          x: gutterX + col * charWidth,
          y: padTop + line * lineHeight,
          w: Math.max((clampedEnd - start) * charWidth, charWidth * 0.8),
          h: lineHeight,
          severity: diagnostic.severity,
          message: label ? `${diagnostic.message} (${label})` : diagnostic.message,
          line: line + 1,
        }
        segments.push(segment)
        const marker = document.createElement('div')
        marker.className = `demo-diag ${diagnostic.severity === 'error' ? 'error' : 'warning'}`
        marker.style.left = `${segment.x}px`
        marker.style.top = `${segment.y}px`
        marker.style.width = `${segment.w}px`
        marker.style.height = `${segment.h}px`
        diagLayer.appendChild(marker)
        const item = document.createElement('li')
        item.textContent = `${diagnostic.severity} on line ${segment.line}: ${segment.message}`
        srDiagnostics.appendChild(item)
      }
    }
  }

  textarea.addEventListener('mousemove', (event) => {
    const rect = editor.getBoundingClientRect()
    const x = event.clientX - rect.left + textarea.scrollLeft
    const y = event.clientY - rect.top + textarea.scrollTop
    const hit = segments.find(
      (segment) =>
        x >= segment.x && x <= segment.x + segment.w && y >= segment.y && y <= segment.y + segment.h,
    )
    if (!hit) {
      hideTooltip()
      return
    }
    tooltip.innerHTML =
      `<span class="demo-tooltip-rule"><code>${escapeHtml(hit.severity)}</code> · line ${hit.line}</span>` +
      `<span class="demo-tooltip-message">${escapeHtml(hit.message)}</span>`
    tooltip.hidden = false
    const segmentLeft = rect.left + hit.x - textarea.scrollLeft
    const segmentTop = rect.top + hit.y - textarea.scrollTop
    tooltip.style.left = `${Math.min(Math.max(8, segmentLeft), window.innerWidth - tooltip.offsetWidth - 8)}px`
    tooltip.style.top = `${Math.max(8, segmentTop - tooltip.offsetHeight - 8)}px`
  })
  textarea.addEventListener('mouseleave', hideTooltip)
  onWindow('scroll', hideTooltip, { passive: true })

  // ---- the four output tabs, all fed by the wasm module ----
  const target = (id) => document.getElementById(id)
  const visibleTab = () => {
    const selected = outputPanel?.querySelector('[role="tab"][aria-selected="true"]')
    return selected ? selected.id.replace('pg-tab-', '') : null
  }

  let current = null
  let generation = 0
  let generatedFor = null
  let semanticFor = null

  const renderAst = async () => {
    const node = target('pg-ast')
    if (!node || !current) return
    let json
    try {
      json = JSON.stringify(current.result.program, jsonReplacer, 2)
    } catch (error) {
      node.innerHTML = `<p class="pg-output-error">${escapeHtml(error.message)}</p>`
      return
    }
    const truncated = json.length > AST_LIMIT
    node.innerHTML =
      (await highlightedHtml(truncated ? json.slice(0, AST_LIMIT) : json, 'pg-plain', 'json')) +
      (truncated
        ? `<p class="pg-note">truncated at ${Math.round(AST_LIMIT / 1024)} KB of ${Math.round(json.length / 1024)} KB</p>`
        : '')
  }

  const renderDiagnosticsPanel = () => {
    const node = target('pg-diagnostics')
    if (!node || !current) return
    const list = current.result.diagnostics
    if (list.length === 0) {
      node.innerHTML = '<p class="pg-note">0 diagnostics</p>'
      return
    }
    node.innerHTML =
      '<table class="pg-structure-table"><thead><tr><th>Severity</th><th>Message</th><th>Span</th></tr></thead><tbody>' +
      list
        .map(
          (diagnostic) =>
            `<tr><td>${escapeHtml(diagnostic.severity)}</td><td>${escapeHtml(diagnostic.message)}${
              diagnostic.help ? `<br><span class="pg-note">${escapeHtml(diagnostic.help)}</span>` : ''
            }</td><td class="num">${diagnostic.start}:${diagnostic.end}</td></tr>`,
        )
        .join('') +
      '</tbody></table>'
  }

  const renderGenerated = async () => {
    const node = target('pg-generated')
    if (!node || !current || generatedFor === current.source) return
    const source = current.source
    generatedFor = source
    let result
    try {
      result = await generate(source, options, { comments: 'some', indent: 2 })
    } catch (error) {
      generatedFor = null
      node.innerHTML = `<p class="pg-output-error">generate failed: ${escapeHtml(error.message)}</p>`
      return
    }
    if (disposed || current?.source !== source) return
    const errors = result.errors.length
      ? `<ul class="pg-output-error">${result.errors
          .map((error) => {
            const index = byteToCharIndex(source, error.start)
            const line = (source.slice(0, index).match(/\n/g) ?? []).length + 1
            return `<li>line ${line}: ${escapeHtml(error.message)}</li>`
          })
          .join('')}</ul>`
      : ''
    node.innerHTML = `${errors}${await highlightedHtml(result.code, 'pg-plain', 'tsx')}`
  }

  const SEMANTIC_ROWS = 200

  const renderSemantic = async () => {
    const node = target('pg-semantic')
    if (!node || !current || semanticFor === current.source) return
    const source = current.source
    semanticFor = source
    let view
    try {
      view = await analyze(source, { ...options, semanticErrors: false })
    } catch (error) {
      semanticFor = null
      node.innerHTML = `<p class="pg-output-error">analyze failed: ${escapeHtml(error.message)}</p>`
      return
    }
    if (disposed || current?.source !== source) return
    const semantic = view.semantic
    const table = symbolFlags()
    const references = new Array(semantic.symbol.count).fill(0)
    for (let i = 0; i < semantic.reference.count; i++) {
      const symbolId = semantic.reference.symbolId(i)
      if (symbolId !== null && symbolId < references.length) references[symbolId] += 1
    }
    const shown = Math.min(semantic.symbol.count, SEMANTIC_ROWS)
    const symbolRows = []
    for (let i = 0; i < shown; i++) {
      symbolRows.push(
        `<tr><td><code>${escapeHtml(semantic.symbol.name(i))}</code></td><td>${escapeHtml(
          flagNames(semantic.symbol.flags(i), table),
        )}</td><td>${escapeHtml(semantic.scope.kind(semantic.symbol.scopeId(i)))}</td><td class="num">${semantic.symbol.declCount(
          i,
        )}</td><td class="num">${references[i]}</td></tr>`,
      )
    }
    const modules = []
    for (let i = 0; i < semantic.import.count; i++) {
      modules.push(
        `<tr><td>import</td><td>${escapeHtml(semantic.import.kind(i))}</td><td><code>${escapeHtml(
          semantic.import.name(i),
        )}</code></td><td><code>${escapeHtml(semantic.import.specifier(i))}</code></td></tr>`,
      )
    }
    for (let i = 0; i < semantic.export.count; i++) {
      modules.push(
        `<tr><td>export</td><td>${escapeHtml(semantic.export.kind(i))}</td><td><code>${escapeHtml(
          semantic.export.name(i),
        )}</code></td><td><code>${escapeHtml(semantic.export.specifier(i))}</code></td></tr>`,
      )
    }
    node.innerHTML =
      `<p class="pg-note">${semantic.scope.count} scopes · ${semantic.symbol.count} symbols · ${semantic.reference.count} references · ${semantic.import.count} imports · ${semantic.export.count} exports</p>` +
      (symbolRows.length
        ? '<table class="pg-structure-table"><thead><tr><th>Symbol</th><th>Flags</th><th>Scope</th><th class="num">Decls</th><th class="num">Refs</th></tr></thead><tbody>' +
          symbolRows.join('') +
          '</tbody></table>' +
          (semantic.symbol.count > shown
            ? `<p class="pg-note">showing the first ${shown} of ${semantic.symbol.count} symbols</p>`
            : '')
        : '<p class="pg-note">0 symbols</p>') +
      (modules.length
        ? '<table class="pg-structure-table"><thead><tr><th>Kind</th><th>Form</th><th>Name</th><th>Specifier</th></tr></thead><tbody>' +
          modules.join('') +
          '</tbody></table>'
        : '')
  }

  const renderTab = (name) => {
    if (name === 'generated') void renderGenerated()
    else if (name === 'semantic') void renderSemantic()
  }
  outputPanel?.addEventListener('click', (event) => {
    const tab = event.target.closest?.('[role="tab"]')
    if (tab) renderTab(tab.id.replace('pg-tab-', ''))
  })

  // ---- the parse lane: every keystroke, debounced ----
  const runParse = async (text) => {
    const token = ++generation
    let result
    try {
      result = await parse(text, options)
    } catch (error) {
      if (token !== generation || disposed) return
      setStatus(`parse failed: ${error.message}`, 'error')
      if (outputStatus) outputStatus.textContent = 'no result: the parser reported a failure'
      return
    }
    if (token !== generation || disposed) return
    current = { source: text, result }
    generatedFor = null
    semanticFor = null
    const errors = result.diagnostics.filter((d) => d.severity === 'error').length
    renderMarkers(text, result.diagnostics)
    setStatus(
      `parsed in ${formatMs(result.ms)} ms · ${plural(result.nodeCount, 'node')} · ${plural(
        result.diagnostics.length,
        'diagnostic',
      )} · runs in your browser`,
      errors > 0 ? 'error' : result.diagnostics.length > 0 ? 'warning' : 'ok',
    )
    void renderAst()
    renderDiagnosticsPanel()
    if (outputStatus) outputStatus.textContent = 'output follows the editor as you type'
    renderTab(visibleTab())
    clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      void renderGenerated()
      void renderSemantic()
    }, 250)
  }

  const schedule = (text, immediate = false) => {
    clearTimeout(parseTimer)
    parseTimer = setTimeout(() => void runParse(text), immediate ? 0 : 60)
  }

  const applySource = (text) => {
    textarea.value = text
    clearDiagnostics()
    hideTooltip()
    renderEditor(text)
    schedule(text, true)
  }

  // ---- editor keys: indent, escape, and auto-closing pairs ----
  const INDENT = '  '
  const insertText = (text) => document.execCommand('insertText', false, text)
  const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`' }

  textarea.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      textarea.blur()
      return
    }
    if (PAIRS[event.key] && !event.metaKey && !event.ctrlKey && !event.altKey) {
      const { selectionStart: start, selectionEnd: end, value } = textarea
      if (start !== end) {
        event.preventDefault()
        const selection = value.slice(start, end)
        insertText(event.key + selection + PAIRS[event.key])
        textarea.setSelectionRange(start + 1, start + 1 + selection.length)
        return
      }
      const next = value[start] ?? ''
      const isQuote = '\'"`'.includes(event.key)
      if (isQuote && next === event.key) {
        event.preventDefault() // skip over the existing closing quote
        textarea.setSelectionRange(start + 1, start + 1)
        return
      }
      if (next === '' || /[\s)\]};,.>]/.test(next)) {
        if (isQuote && /[\w'"`]/.test(value[start - 1] ?? '')) return
        event.preventDefault()
        insertText(event.key + PAIRS[event.key])
        textarea.setSelectionRange(start + 1, start + 1)
      }
      return
    }
    if (')]}'.includes(event.key)) {
      const { selectionStart: start, selectionEnd: end, value } = textarea
      if (start === end && value[start] === event.key) {
        event.preventDefault() // skip over the auto-inserted closer
        textarea.setSelectionRange(start + 1, start + 1)
      }
      return
    }
    if (event.key === 'Backspace') {
      const { selectionStart: start, selectionEnd: end, value } = textarea
      if (start === end && PAIRS[value[start - 1]] === value[start]) {
        event.preventDefault() // delete an empty pair together
        textarea.setSelectionRange(start - 1, start + 1)
        insertText('')
      }
      return
    }
    if (event.key === 'Tab') {
      event.preventDefault()
      const { selectionStart: start, selectionEnd: end, value } = textarea
      const multiline = value.slice(start, end).includes('\n')
      if (!event.shiftKey && !multiline) {
        insertText(INDENT)
        return
      }
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const lastLineBreak = value.indexOf('\n', Math.max(end - 1, lineStart))
      const blockEnd = lastLineBreak === -1 ? value.length : lastLineBreak
      const block = value.slice(lineStart, blockEnd)
      const updated = event.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, INDENT)
      if (updated === block) return
      textarea.setSelectionRange(lineStart, blockEnd)
      insertText(updated)
      textarea.setSelectionRange(lineStart, lineStart + updated.length)
      return
    }
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      const { selectionStart: start, value } = textarea
      const lineStart = value.lastIndexOf('\n', start - 1) + 1
      const indent = /^[ \t]*/.exec(value.slice(lineStart, start))[0]
      const extra = '{(['.includes(value[start - 1]) ? INDENT : ''
      insertText(`\n${indent}${extra}`)
    }
  })

  textarea.addEventListener('input', () => {
    renderEditor(textarea.value)
    schedule(textarea.value)
  })

  // ---- panel actions ----
  panel.querySelector('#demo-reset')?.addEventListener('click', () => {
    applySource(original)
    if (scenarioNote) scenarioNote.textContent = scenarioNote.dataset.idle ?? ''
  })

  panel.querySelector('#demo-open')?.addEventListener('click', () => {
    location.assign(`${playgroundHref()}#code=${b64uEncode(textarea.value)}&lang=${options.lang}&src=${options.sourceType}`)
  })

  panel.querySelector('#demo-share')?.addEventListener('click', async () => {
    const params = new URLSearchParams()
    params.set('code', b64uEncode(textarea.value))
    params.set('lang', options.lang)
    params.set('src', options.sourceType)
    const hash = `#${params.toString()}`
    history.replaceState(null, '', hash)
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}${hash}`)
      setStatus('share link copied to clipboard')
    } catch {
      setStatus('share link is in the address bar', 'warning')
    }
  })

  // ---- fixture scenarios, inlined by docs/build.mjs from test/parser/misc/tsrx ----
  const fixturesEl = document.getElementById('pg-fixtures')
  if (fixturesEl) {
    let fixtures = null
    try {
      fixtures = JSON.parse(fixturesEl.textContent)
    } catch {}
    for (const button of document.querySelectorAll('[data-scenario]')) {
      const entry = fixtures?.[button.dataset.scenario]
      if (!entry) continue
      button.addEventListener('click', () => {
        applySource(entry.source)
        if (scenarioNote) scenarioNote.textContent = entry.note
      })
    }
  }

  // ---- boot: shared source from the hash, then the first real parse ----
  if (shared.code && shared.code !== original) applySource(shared.code)
  else schedule(original, true)

  return cleanup
}
