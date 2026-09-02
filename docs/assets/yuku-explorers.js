// The engine-backed figures on the guide pages.
//
// Four of them, one per page: the AST/source explorer on Parser, the symbol
// explorer on Analyzer, the codegen options walkthrough on Code Generator, and
// the measure-in-this-tab figure on Benchmarks.
// Every line any of them prints comes from docs/assets/yuku-wasm.js, which is
// the real yuku-tsrx dialect compiled to WebAssembly and running in the
// reader's tab. There is no pre-computed output in this file: if the module
// cannot start, the figure says why and stays the read-only fence the build
// shipped.
//
// The module is fetched only on a page that has one of the three figures, and
// the engine is only asked to boot once a figure is near the viewport, because
// the wasm is over a megabyte and a reader who never scrolls that far should
// not pay for it.

import { analyze, generate, parse, ready, symbolFlags } from './yuku-wasm.js'
import { escapeHtml, flagNames, formatMs, plural } from './yuku-shared.js'
import { createLayeredEditor } from './widgets/_editor.js'
import { highlightedHtml, plainStatus } from './widgets/_shared.js'
import { markRanges } from './widgets/_source-pane.js'

const PARSE_OPTIONS = { lang: 'tsx', sourceType: 'module', semanticErrors: true }
const ANALYZE_OPTIONS = { lang: 'tsx', sourceType: 'module' }
// The comments option can only act on comments the parse kept, so the codegen
// figure asks for them. Without this every comments mode prints the same text.
const CODEGEN_PARSE_OPTIONS = { lang: 'tsx', sourceType: 'module', attachComments: true }

const MAX_TREE_DEPTH = 12

// ---------- small shared helpers ----------

// A flat pre-order list of every node in the tree: the AST rows are this list,
// and the innermost-node lookup under the cursor is a scan of it. Object
// properties that carry a node, and arrays of nodes, are the whole shape of the
// decoded tree; `comments` is a sibling list, not part of the program.
export function walkNodes(program) {
  const out = []
  const isNode = (value) =>
    value !== null &&
    typeof value === 'object' &&
    typeof value.type === 'string' &&
    typeof value.start === 'number' &&
    typeof value.end === 'number'
  const visit = (node, depth, parentIndex) => {
    const index = out.length
    out.push({ type: node.type, start: node.start, end: node.end, depth, parentIndex })
    for (const [key, value] of Object.entries(node)) {
      if (key === 'comments') continue
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, depth + 1, index)
      } else if (isNode(value)) {
        visit(value, depth + 1, index)
      }
    }
  }
  visit(program, 0, -1)
  return out
}

const overlaps = (segment, span) => segment.start < span.end && segment.end > span.start

function readSegments(host) {
  return [...host.querySelectorAll('.ex-seg')].map((node) => ({
    node,
    start: Number(node.dataset.start),
    end: Number(node.dataset.end),
  }))
}

function paint(segments, spans, className) {
  for (const segment of segments) {
    segment.node.classList.toggle(
      className,
      spans.some((span) => overlaps(segment, span)),
    )
  }
}

function clearClass(segments, className) {
  for (const segment of segments) segment.node.classList.remove(className)
}

// Keep a row visible inside the tree's own scroll box without moving the page:
// scrollIntoView would scroll every scrollable ancestor, including the window.
function revealInside(container, row) {
  const top =
    row.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop
  const bottom = top + row.offsetHeight
  if (top < container.scrollTop) container.scrollTop = top
  else if (bottom > container.scrollTop + container.clientHeight) {
    container.scrollTop = bottom - container.clientHeight
  }
}

function statusLine(figure, text) {
  const status = figure.querySelector('[data-ex-status]')
  if (status) status.textContent = text
}

// The engine never started: the figure keeps the fence the build shipped and
// says why it is not going to do anything else.
function unavailable(figure, error) {
  const message = error?.message ?? String(error)
  const out = figure.querySelector('[data-ex-out]')
  if (out) {
    out.innerHTML = `<p class="ex-note ex-unavailable">in-browser parser unavailable: ${escapeHtml(
      message,
    )}</p>`
  }
  statusLine(figure, `in-browser parser unavailable: ${message}`)
  figure.dataset.exState = 'unavailable'
}

// The engine ran and refused this input, which after an edit is an ordinary
// answer rather than a broken page. Print what it said and leave the controls
// alone so the next keystroke can fix it.
function showError(figure, prefix, error) {
  const message = error?.message ?? String(error)
  const out = figure.querySelector('[data-ex-out]')
  if (out) {
    out.innerHTML = `<p class="ex-note ex-unavailable">${escapeHtml(prefix)}: ${escapeHtml(
      message,
    )}</p>`
  }
  statusLine(figure, `${prefix}: ${message}`)
  figure.dataset.exState = 'error'
}

// ---------- source pane ----------

function createSourcePane(figure, { segmented, onChange }) {
  const host = figure.querySelector('[data-ex-source]')
  const original = figure.dataset.source ?? ''
  let source = original
  let editor = null
  let currentSpans = []

  const renderEditorMirror = async () => {
    if (!editor) return
    await editor.render()
  }

  const editorHtml = (value) => highlightedHtml(value, 'ex-source ex-source-plain')

  const pane = {
    get source() {
      return source
    },
    segments: [],
    async render(spans) {
      currentSpans = spans ?? []
      await renderEditorMirror()
    },
    onSegmentHover: null,
    onSegmentClick: null,
    onSourceLeave: null,
    dispose() {
      editor?.dispose()
    },
  }

  editor = createLayeredEditor({
    host,
    source,
    render: editorHtml,
    afterRender(mirror) {
      if (!segmented) return
      markRanges(mirror, [{ start: 0, end: source.length }, ...currentSpans], 'ex-seg')
      pane.segments = readSegments(mirror)
    },
    onChange(value) {
      source = value
      reset.hidden = source === original
      onChange(source)
    },
    ariaLabel: 'Editable source for this figure',
    rows: Math.min(Math.max(source.split('\n').length, 6), 30),
    onPointerOffset(target, offset) {
      const segment = target?.closest('.ex-seg')
      pane.onSegmentHover?.(Number(segment?.dataset.start ?? offset))
    },
    onClickOffset: (offset) => pane.onSegmentClick?.(offset),
    onFocusOffset: (offset) => pane.onSegmentHover?.(offset),
  })
  const controls = figure.querySelector('[data-ex-controls]')
  const reset = document.createElement('button')
  reset.type = 'button'
  reset.dataset.exReset = ''
  reset.textContent = 'Reset source'
  reset.hidden = true
  controls?.append(reset)
  reset.addEventListener('click', async () => {
    source = original
    reset.hidden = true
    await editor.setValue(source)
    onChange(source)
  })

  host.addEventListener('mouseover', (event) => {
    const segment = event.target.closest('.ex-seg')
    if (segment && pane.onSegmentHover) pane.onSegmentHover(Number(segment.dataset.start))
  })
  host.addEventListener('click', (event) => {
    const segment = event.target.closest('.ex-seg')
    if (segment && pane.onSegmentClick) pane.onSegmentClick(Number(segment.dataset.start))
  })
  host.addEventListener('mouseleave', () => pane.onSourceLeave?.())

  return pane
}

function chipGroup(label, name, options) {
  const chips = options
    .map(
      (option) =>
        `<button type="button" data-ex-option="${escapeHtml(name)}" data-ex-value="${escapeHtml(
          option.value,
        )}" aria-pressed="${option.value === options.find((o) => o.selected)?.value}"${
          option.disabled ? ' disabled' : ''
        } title="${escapeHtml(option.title ?? `${name}=${option.value}`)}">${escapeHtml(option.label ?? `${option.value[0].toUpperCase()}${option.value.slice(1)}`)}</button>`,
    )
    .join('')
  return `<div class="ex-chip-group" role="group" aria-label="${escapeHtml(
    label,
  )}"><span class="ex-chip-label">${escapeHtml(label)}</span>${chips}</div>`
}

// ---------- 3.2 the AST / source explorer ----------

const leaveBound = new WeakSet()
const latestClear = new WeakMap()

async function runAstExplorer(figure, pane) {
  const out = figure.querySelector('[data-ex-out]')
  const diagnosticsHost = figure.querySelector('[data-ex-diagnostics]')
  const source = pane.source
  let result
  try {
    result = await parse(source, PARSE_OPTIONS)
  } catch (error) {
    showError(figure, 'parse failed', error)
    return
  }
  const nodes = walkNodes(result.program)
  await pane.render(nodes)

  let html = ''
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.depth > MAX_TREE_DEPTH) continue
    html += `<li class="ex-tree-row" style="--ex-depth:${node.depth}"><button type="button" aria-pressed="false" data-ex-node="${i}"><code>${escapeHtml(
      node.type,
    )}</code> <span class="explorer-span">${node.start}:${node.end}</span></button></li>`
    if (node.depth === MAX_TREE_DEPTH) {
      let deeper = 0
      for (let j = i + 1; j < nodes.length && nodes[j].depth > MAX_TREE_DEPTH; j++) deeper++
      if (deeper > 0) {
        html += `<li class="ex-tree-more" style="--ex-depth:${node.depth + 1}">… ${plural(
          deeper,
          'deeper node',
        )}</li>`
      }
    }
  }
  out.innerHTML = `<ul class="ex-tree" data-ex-tree>${html}</ul>`
  out.scrollTop = 0
  const tree = out.querySelector('[data-ex-tree]')
  const buttons = new Map(
    [...tree.querySelectorAll('[data-ex-node]')].map((button) => [
      Number(button.dataset.exNode),
      button,
    ]),
  )

  let pinned = null
  const select = (index, { reveal = false } = {}) => {
    for (const [key, button] of buttons) button.setAttribute('aria-pressed', String(key === index))
    if (index === null) {
      clearClass(pane.segments, 'ex-hit')
      return
    }
    const node = nodes[index]
    figure.querySelector('[data-ex-readout]').textContent = `${node.type} spans ${node.start}:${node.end}.`
    paint(pane.segments, [node], 'ex-hit')
    const button = buttons.get(index)
    if (button && reveal) revealInside(out, button.parentElement)
  }

  tree.addEventListener('mouseover', (event) => {
    const button = event.target.closest('[data-ex-node]')
    if (button) select(Number(button.dataset.exNode))
  })
  tree.addEventListener('focusin', (event) => {
    const button = event.target.closest('[data-ex-node]')
    if (button) select(Number(button.dataset.exNode))
  })
  tree.addEventListener('click', (event) => {
    const button = event.target.closest('[data-ex-node]')
    if (!button) return
    const index = Number(button.dataset.exNode)
    pinned = pinned === index ? null : index
    select(pinned ?? index)
  })
  // One listener per figure, not one per parse: an edit rebuilds the tree and
  // the closures with it, so `latestClear` is what the listener reaches for.
  latestClear.set(figure, () => select(pinned))
  if (!leaveBound.has(figure)) {
    leaveBound.add(figure)
    figure.addEventListener('mouseleave', () => latestClear.get(figure)?.())
  }

  // The innermost node under the cursor is the smallest span that contains the
  // offset, which is what a reader pointing at a character means by "this".
  const nodeAt = (offset) => {
    let best = null
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      if (node.start > offset || node.end <= offset) continue
      if (best === null || node.end - node.start <= nodes[best].end - nodes[best].start) best = i
    }
    return best
  }
  pane.onSegmentHover = (offset) => {
    const best = nodeAt(offset)
    if (best !== null) select(best, { reveal: true })
  }
  pane.onSegmentClick = (offset) => {
    pinned = nodeAt(offset)
    select(pinned)
  }
  pane.onSourceLeave = () => {
    select(pinned)
    out.scrollTop = 0
  }

  const errors = result.diagnostics.length
  if (diagnosticsHost) {
    diagnosticsHost.innerHTML = errors
      ? `<ul>${result.diagnostics
          .map(
            (diagnostic) =>
              `<li><code>${escapeHtml(diagnostic.severity)}</code> ${escapeHtml(
                diagnostic.message,
              )} <span class="explorer-span">${diagnostic.start}:${diagnostic.end}</span></li>`,
          )
          .join('')}</ul>`
      : ''
  }
  plainStatus(figure, `${plural(result.nodeCount, 'node')} parsed with ${plural(errors, 'diagnostic')}.`, result.ms)
  figure.dataset.exState = 'ready'
}

// ---------- 3.3 the symbol explorer ----------

async function runSymbolExplorer(figure, pane) {
  const out = figure.querySelector('[data-ex-out]')
  const source = pane.source
  let view
  try {
    view = await analyze(source, ANALYZE_OPTIONS)
  } catch (error) {
    showError(figure, 'analyze failed', error)
    return
  }
  const semantic = view.semantic
  const table = symbolFlags()

  const symbols = []
  for (let i = 0; i < semantic.symbol.count; i++) {
    const decls = []
    for (let j = 0; j < semantic.symbol.declCount(i); j++) {
      const node = semantic.symbol.declNode(i, j)
      decls.push({ start: node.start, end: node.end })
    }
    symbols.push({
      name: semantic.symbol.name(i),
      flags: flagNames(semantic.symbol.flags(i), table),
      scope: semantic.scope.kind(semantic.symbol.scopeId(i)),
      decls,
      refs: [],
    })
  }
  const unresolved = []
  for (let r = 0; r < semantic.reference.count; r++) {
    const span = { start: semantic.reference.start(r), end: semantic.reference.end(r) }
    const symbolId = semantic.reference.symbolId(r)
    if (symbolId === null) unresolved.push({ ...span, name: semantic.reference.name(r) })
    else if (symbols[symbolId]) symbols[symbolId].refs.push(span)
  }
  const scopes = []
  for (let s = 0; s < semantic.scope.count; s++) {
    scopes.push({
      id: s,
      kind: semantic.scope.kind(s),
      parentId: semantic.scope.parentId(s),
      start: semantic.scope.start(s),
      end: semantic.scope.end(s),
    })
  }

  const spans = [...unresolved]
  for (const symbol of symbols) spans.push(...symbol.decls, ...symbol.refs)
  for (const scope of scopes) spans.push(scope)
  await pane.render(spans)
  paint(pane.segments, unresolved, 'ex-unresolved')
  for (const segment of pane.segments) {
    if (segment.node.classList.contains('ex-unresolved')) {
      segment.node.title = 'resolves to nothing declared in this file'
    }
  }

  const rows = symbols
    .map(
      (symbol, i) =>
        `<tr tabindex="0" data-ex-symbol="${i}"><td><code>${escapeHtml(
          symbol.name,
        )}</code></td><td>${escapeHtml(symbol.flags)}</td><td>${escapeHtml(
          symbol.scope,
        )}</td><td class="num">${symbol.decls.length}</td><td class="num">${symbol.refs.length}</td></tr>`,
    )
    .join('')

  const childrenOf = (parentId) => scopes.filter((scope) => scope.parentId === parentId)
  const scopeTree = (parentId, depth) =>
    childrenOf(parentId)
      .map(
        (scope) =>
          `<li class="ex-tree-row" style="--ex-depth:${depth}"><button type="button" aria-pressed="false" data-ex-scope="${scope.id}"><code>${escapeHtml(
            scope.kind,
          )}</code> <span class="explorer-span">${scope.start}:${scope.end}</span></button></li>${scopeTree(
            scope.id,
            depth + 1,
          )}`,
      )
      .join('')

  out.innerHTML =
    `<div class="table-wrap"><table><thead><tr><th>Symbol</th><th>Flags</th><th>Scope</th><th class="num">Decls</th><th class="num">Refs</th></tr></thead><tbody data-ex-symbols>${rows}</tbody></table></div>` +
    `<details open class="ex-scopes"><summary>Scope tree</summary><ul class="ex-tree" data-ex-scope-tree>${scopeTree(
      null,
      0,
    )}</ul></details>`

  const body = out.querySelector('[data-ex-symbols]')
  const scopeList = out.querySelector('[data-ex-scope-tree]')

  const selectSymbol = (index) => {
    for (const row of body.querySelectorAll('[data-ex-symbol]')) {
      const active = Number(row.dataset.exSymbol) === index
      row.classList.toggle('ex-row-active', active)
      // aria-pressed is for buttons; a table row says which one it is with
      // aria-current, which is allowed on any element.
      if (active) row.setAttribute('aria-current', 'true')
      else row.removeAttribute('aria-current')
    }
    clearClass(pane.segments, 'ex-decl')
    clearClass(pane.segments, 'ex-ref')
    if (index === null || !symbols[index]) return
    figure.querySelector('[data-ex-readout]').textContent = `${symbols[index].name}: ${symbols[index].scope} scope, symbol ${index}.`
    paint(pane.segments, symbols[index].decls, 'ex-decl')
    paint(pane.segments, symbols[index].refs, 'ex-ref')
  }

  body.addEventListener('click', (event) => {
    const row = event.target.closest('[data-ex-symbol]')
    if (row) selectSymbol(Number(row.dataset.exSymbol))
  })
  body.addEventListener('mouseover', (event) => {
    const row = event.target.closest('[data-ex-symbol]')
    if (row) selectSymbol(Number(row.dataset.exSymbol))
  })
  body.addEventListener('focusin', (event) => {
    const row = event.target.closest('[data-ex-symbol]')
    if (row) selectSymbol(Number(row.dataset.exSymbol))
  })
  body.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const row = event.target.closest('[data-ex-symbol]')
    if (!row) return
    event.preventDefault()
    selectSymbol(Number(row.dataset.exSymbol))
  })

  const highlightScope = (id) => {
    for (const button of scopeList.querySelectorAll('[data-ex-scope]')) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.exScope) === id))
    }
    clearClass(pane.segments, 'ex-scope')
    if (id === null) return
    const scope = scopes.find((candidate) => candidate.id === id)
    if (scope) {
      paint(pane.segments, [scope], 'ex-scope')
      figure.querySelector('[data-ex-readout]').textContent = `Scope ${id} is ${scope.kind} and spans ${scope.start}:${scope.end}.`
    }
  }
  scopeList.addEventListener('mouseover', (event) => {
    const button = event.target.closest('[data-ex-scope]')
    if (button) highlightScope(Number(button.dataset.exScope))
  })
  scopeList.addEventListener('focusin', (event) => {
    const button = event.target.closest('[data-ex-scope]')
    if (button) highlightScope(Number(button.dataset.exScope))
  })
  scopeList.addEventListener('mouseleave', () => highlightScope(null))

  // Clicking the source is the same question asked from the other side: the
  // symbol whose declaration or reference covers this character.
  pane.onSegmentClick = (offset) => {
    const index = symbols.findIndex((symbol) =>
      [...symbol.decls, ...symbol.refs].some((span) => span.start <= offset && span.end > offset),
    )
    if (index >= 0) selectSymbol(index)
  }

  pane.onSegmentHover = (offset) => {
    const missing = unresolved.find((span) => span.start <= offset && span.end > offset)
    if (missing) {
      figure.querySelector('[data-ex-readout]').textContent = `${missing.name}: no declaration in this file, symbolId is null.`
      return
    }
    const index = symbols.findIndex((symbol) =>
      [...symbol.decls, ...symbol.refs].some((span) => span.start <= offset && span.end > offset),
    )
    if (index >= 0) selectSymbol(index)
  }

  plainStatus(
    figure,
    unresolved.length
      ? `${plural(unresolved.length, 'name')} resolves to nothing: ${unresolved.map((entry) => entry.name).join(', ')}`
      : 'Every name resolves to a declaration.',
    view.ms,
    'analyzed',
  )
  figure.dataset.exState = 'ready'
}

// ---------- 3.4 the codegen options walkthrough ----------

const CODEGEN_DEFAULTS = {
  format: 'pretty',
  indent: 2,
  quotes: 'preserve',
  comments: 'some',
  strip: false,
  minify: false,
}

function equivalentCall(state) {
  const parts = []
  if (state.format !== CODEGEN_DEFAULTS.format) parts.push(`format: "${state.format}"`)
  if (state.format === 'pretty' && state.indent !== CODEGEN_DEFAULTS.indent) {
    parts.push(`indent: ${state.indent}`)
  }
  if (state.quotes !== CODEGEN_DEFAULTS.quotes) parts.push(`quotes: "${state.quotes}"`)
  if (state.comments !== CODEGEN_DEFAULTS.comments) parts.push(`comments: "${state.comments}"`)
  if (state.strip) parts.push('strip: true')
  if (state.minify) parts.push('minify: { syntax: true }')
  return `generate(program, {${parts.length ? ` ${parts.join(', ')} ` : ''}})`
}

function codegenControls(figure, state, onChange) {
  const controls = figure.querySelector('[data-ex-controls]')
  const options = document.createElement('div')
  options.className = 'ex-option-rows'
  options.innerHTML =
    chipGroup('Formatting', 'format', [
      { value: 'pretty', selected: true },
      { value: 'compact' },
    ]) +
    `<div class="ex-chip-group"><span class="ex-chip-label">Indent</span><input title="indent" type="number" min="0" max="8" step="1" value="2" data-ex-indent aria-label="Spaces per indentation level"></div>` +
    chipGroup('Quotes', 'quotes', [
      { value: 'preserve', selected: true },
      { value: 'double' },
      { value: 'single' },
      {
        value: 'shortest',
        disabled: true,
        title:
          'not available: the Quotes enum in src/dialect/codegen.zig has preserve, double and single, so the host cannot request shortest',
      },
    ]) +
    chipGroup('Comments', 'comments', [
      { value: 'none' },
      { value: 'all' },
      { value: 'some', selected: true },
      { value: 'line' },
      { value: 'block' },
    ]) +
    `<div class="ex-chip-group">` +
    `<button type="button" role="switch" title="strip" data-ex-flag="strip" aria-checked="false">Strip types</button>` +
    `<button type="button" role="switch" title="minify" data-ex-flag="minify" aria-checked="false">Minify syntax</button>` +
    `</div>`
  controls.prepend(options)

  const indentInput = options.querySelector('[data-ex-indent]')
  const syncIndent = () => {
    indentInput.disabled = state.format === 'compact'
  }

  options.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-ex-option]')
    if (chip && !chip.disabled) {
      state[chip.dataset.exOption] = chip.dataset.exValue
      for (const sibling of chip.parentElement.querySelectorAll('[data-ex-option]')) {
        sibling.setAttribute('aria-pressed', String(sibling === chip))
      }
      syncIndent()
      onChange()
      return
    }
    const flag = event.target.closest('[data-ex-flag]')
    if (!flag) return
    state[flag.dataset.exFlag] = flag.getAttribute('aria-checked') !== 'true'
    flag.setAttribute('aria-checked', String(state[flag.dataset.exFlag]))
    onChange()
  })
  options.addEventListener('change', (event) => {
    if (event.target === indentInput) {
      const value = Number(indentInput.value)
      state.indent = Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), 8) : 2
      indentInput.value = String(state.indent)
      onChange()
      return
    }
  })
  syncIndent()
}

async function runCodegen(figure, pane, state) {
  const out = figure.querySelector('[data-ex-out]')
  let result
  try {
    result = await generate(pane.source, CODEGEN_PARSE_OPTIONS, {
      strip: state.strip,
      minify: state.minify,
      format: state.format,
      quotes: state.quotes,
      comments: state.comments,
      indent: state.indent,
    })
  } catch (error) {
    showError(figure, 'generate failed', error)
    return
  }
  const errors = result.errors.length
    ? `<ul class="explorer-diagnostics ex-errors">${result.errors
        .map(
          (error) =>
            `<li>${escapeHtml(error.message)} <span class="explorer-span">${error.start}:${
              error.end
            }</span></li>`,
        )
        .join('')}</ul>`
    : ''
  out.innerHTML = `${errors}${await highlightedHtml(
    result.code,
    'ex-generated',
  )}<p class="ex-call"><code>${escapeHtml(equivalentCall(state))}</code></p>`
  out.querySelector('.ex-generated')?.setAttribute('data-ex-generated', '')
  const summary = `${state.strip ? 'types stripped' : 'types kept'}, ${state.comments === 'none' ? 'comments removed' : `${state.comments === 'all' ? 'all' : state.comments} comments kept`}.`
  plainStatus(figure, summary, result.ms, 'generated')
  figure.dataset.exState = 'ready'
}

// ---------- 3.11 measure in this tab (reference/benchmarks) ----------

const BENCH_WARMUP = 20
// A browser clamps performance.now() to about a tenth of a millisecond, and one
// parse of a guide-sized snippet is faster than that, so timing single parses
// would print a column of zeroes and a made-up median. Parses are timed in
// batches sized from the warm-up to take at least this long, and every number
// below is a per-parse figure derived from a batch that the clock could
// actually resolve. The table says so, because it changes what p95 means: it is
// the p95 of the batches, not of individual parses.
const BENCH_BATCH_TARGET_MS = 1
const BENCH_MIN_BATCHES = 4
// The first parses after the module boots are far slower than the steady state,
// so the batch size is calibrated from a second short burst rather than from
// the warm-up, which would size the batches off the cold numbers.
const BENCH_CALIBRATION = 20
// Long runs are handed back to the event loop between batches so the tab can
// paint. The yield never sits inside a timed region.
const BENCH_YIELD_MS = 40

function percentileOf(sorted, fraction) {
  if (sorted.length === 0) return 0
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1)
  return sorted[Math.max(index, 0)]
}

const integer = (value) => Math.round(value).toLocaleString('en-US')

function browserLabel() {
  const brands = navigator.userAgentData?.brands ?? []
  const brand = brands.find((entry) => !/not.*brand/i.test(entry.brand))
  if (brand) return `${brand.brand} ${brand.version}`
  const match = /(Firefox|Edg|Chrome|Safari)\/(\d+)/.exec(navigator.userAgent ?? '')
  return match ? `${match[1] === 'Edg' ? 'Edge' : match[1]} ${match[2]}` : 'your browser'
}

function benchState(figure) {
  const script = figure.querySelector('[data-bench-samples]')
  const samples = JSON.parse(script.textContent)
  const first = figure.querySelector('[data-bench-sample][aria-pressed="true"]')
  const iterations = figure.querySelector('[data-bench-iterations][aria-pressed="true"]')
  return {
    samples,
    sample: first?.dataset.benchSample ?? Object.keys(samples)[0],
    iterations: Number(iterations?.dataset.benchIterations ?? 500),
    running: false,
  }
}

async function runBench(figure, state) {
  if (state.running) return
  state.running = true
  const out = figure.querySelector('[data-ex-out]')
  const run = figure.querySelector('[data-bench-run]')
  const sample = state.samples[state.sample]
  const bytes = new TextEncoder().encode(sample.source).length
  run.disabled = true
  figure.dataset.benchState = 'running'
  statusLine(figure, `parsing ${sample.label} ${state.iterations} times in this tab`)
  out.innerHTML = `<p class="ex-note">running ${state.iterations} parses of ${escapeHtml(
    sample.label,
  )}</p>`
  const timings = []
  const started = performance.now()
  let batchSize = 1
  let batches = 0
  try {
    for (let i = 0; i < BENCH_WARMUP; i++) await parse(sample.source, PARSE_OPTIONS)
    const calibrationStarted = performance.now()
    for (let i = 0; i < BENCH_CALIBRATION; i++) await parse(sample.source, PARSE_OPTIONS)
    const perParse = (performance.now() - calibrationStarted) / BENCH_CALIBRATION
    // Big enough for the clock to resolve, small enough that a median and a
    // p95 are taken over more than a couple of numbers.
    batchSize = Math.max(
      1,
      Math.min(
        state.iterations,
        Math.ceil(BENCH_BATCH_TARGET_MS / Math.max(perParse, 0.001)),
        Math.floor(state.iterations / BENCH_MIN_BATCHES) || 1,
      ),
    )
    batches = Math.max(1, Math.floor(state.iterations / batchSize))
    let painted = performance.now()
    for (let batch = 0; batch < batches; batch++) {
      const at = performance.now()
      for (let i = 0; i < batchSize; i++) await parse(sample.source, PARSE_OPTIONS)
      timings.push((performance.now() - at) / batchSize)
      if (performance.now() - painted > BENCH_YIELD_MS) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        painted = performance.now()
      }
    }
  } catch (error) {
    state.running = false
    run.disabled = false
    showError(figure, 'parse failed', error)
    return
  }
  const wall = performance.now() - started
  const parsed = batches * batchSize
  const sorted = [...timings].sort((a, b) => a - b)
  const medianMs = percentileOf(sorted, 0.5)
  const p95Ms = percentileOf(sorted, 0.95)
  const perSecond = medianMs > 0 ? 1000 / medianMs : 0
  const megabytes = (bytes * perSecond) / 1e6
  out.innerHTML = `<div class="table-wrap"><table>
  <thead><tr><th scope="col">Measure</th><th scope="col">In this tab</th></tr></thead>
  <tbody>
    <tr><th scope="row">Sample</th><td>${escapeHtml(sample.label)}</td></tr>
    <tr><th scope="row">Sample bytes</th><td>${integer(bytes)}</td></tr>
    <tr><th scope="row">Parses timed</th><td>${integer(parsed)} of ${integer(state.iterations)} asked for, after ${BENCH_WARMUP + BENCH_CALIBRATION} warm-up and calibration parses</td></tr>
    <tr><th scope="row">Timed in</th><td>${integer(batches)} batch${batches === 1 ? '' : 'es'} of ${integer(batchSize)}, because a browser clock cannot resolve one parse</td></tr>
    <tr><th scope="row">Median ns per parse</th><td data-bench-median>${integer(medianMs * 1e6)}</td></tr>
    <tr><th scope="row">p95 ns per parse, by batch</th><td data-bench-p95>${integer(p95Ms * 1e6)}</td></tr>
    <tr><th scope="row">Parses per second</th><td data-bench-rate>${integer(perSecond)}</td></tr>
    <tr><th scope="row">MB per second</th><td data-bench-throughput>${megabytes.toFixed(1)}</td></tr>
  </tbody>
</table></div>`
  plainStatus(figure, `${integer(parsed)} parses completed on ${sample.label} in ${browserLabel()}.`, wall, 'measured')
  figure.dataset.benchState = 'ready'
  state.running = false
  run.disabled = false
}

function benchControls(figure, state) {
  const press = (group, attribute, value) => {
    for (const chip of figure.querySelectorAll(`[${attribute}]`)) {
      chip.setAttribute('aria-pressed', String(chip.getAttribute(attribute) === value))
    }
  }
  figure.addEventListener('click', (event) => {
    const sample = event.target.closest('[data-bench-sample]')
    if (sample) {
      state.sample = sample.dataset.benchSample
      press(figure, 'data-bench-sample', state.sample)
      return
    }
    const iterations = event.target.closest('[data-bench-iterations]')
    if (iterations) {
      state.iterations = Number(iterations.dataset.benchIterations)
      press(figure, 'data-bench-iterations', iterations.dataset.benchIterations)
      return
    }
    if (event.target.closest('[data-bench-run]')) runBench(figure, state)
  })
}

// ---------- boot ----------

function bootFigure(figure, cleanupCallbacks) {
  if (figure.hasAttribute('data-bench-live')) {
    const state = benchState(figure)
    benchControls(figure, state)
    ready()
      .then(() => {
        figure.querySelector('[data-bench-run]').disabled = false
        return runBench(figure, state)
      })
      .catch((error) => unavailable(figure, error))
    return
  }
  if (figure.hasAttribute('data-codegen-walkthrough')) {
    const state = { ...CODEGEN_DEFAULTS }
    const pane = createSourcePane(figure, {
      segmented: false,
      onChange: () => runCodegen(figure, pane, state),
    })
    cleanupCallbacks.push(() => pane.dispose())
    ready()
      .then(() => {
        codegenControls(figure, state, () => runCodegen(figure, pane, state))
        return runCodegen(figure, pane, state)
      })
      .catch((error) => unavailable(figure, error))
    return
  }

  const isAst = figure.hasAttribute('data-ast-explorer')
  const run = () => (isAst ? runAstExplorer(figure, pane) : runSymbolExplorer(figure, pane))
  const pane = createSourcePane(figure, { segmented: true, onChange: () => run() })
  cleanupCallbacks.push(() => pane.dispose())
  ready()
    .then(() => {
      return run()
    })
    .catch((error) => unavailable(figure, error))
}

export function init(cleanupCallbacks = []) {
  const figures = document.querySelectorAll(
    '[data-ast-explorer]:not([data-ex-ready]), [data-symbol-explorer]:not([data-ex-ready]), [data-codegen-walkthrough]:not([data-ex-ready]), [data-bench-live]:not([data-ex-ready])',
  )
  for (const figure of figures) {
    figure.dataset.exReady = '1'
    if (typeof IntersectionObserver !== 'function') {
      bootFigure(figure, cleanupCallbacks)
      continue
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        bootFigure(figure, cleanupCallbacks)
      },
      { rootMargin: '400px 0px' },
    )
    observer.observe(figure)
    cleanupCallbacks.push(() => observer.disconnect())
  }
}
