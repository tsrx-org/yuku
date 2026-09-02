// Runtime half of docs/widgets/symbol-table.mjs: every row below is read out of
// the SemanticView the wasm analyzer returns in this tab.
import { escapeHtml, plural } from '../yuku-shared.js'
import { analyze, ready } from '../yuku-wasm.js'
import { createLayeredEditor } from './_editor.js'
import { highlightedHtml, plainStatus } from './_shared.js'
import {
  clearClass,
  collectNodes,
  failWidget,
  innermostAt,
  paint,
  readSegments,
  reportStatus,
  markRanges,
} from './_source-pane.js'

const ANALYZE_OPTIONS = { lang: 'tsx', sourceType: 'module' }
const IDLE_READOUT = 'Focus or hover a token to read its scope and symbol.'

const cell = (value) => `<td>${escapeHtml(value === null ? 'null' : String(value))}</td>`
const idCell = (value) => `<td class="num">${escapeHtml(value === null ? 'null' : String(value))}</td>`

function readModel(view, mode) {
  const semantic = view.semantic
  const scopes = []
  for (let s = 0; s < semantic.scope.count; s++) {
    scopes.push({
      id: s,
      kind: semantic.scope.kind(s),
      parentId: semantic.scope.parentId(s),
      nodeType: semantic.scope.node(s).type,
      start: semantic.scope.start(s),
      end: semantic.scope.end(s),
    })
  }
  const symbols = []
  for (let i = 0; i < semantic.symbol.count; i++) {
    const decls = []
    for (let j = 0; j < semantic.symbol.declCount(i); j++) {
      const node = semantic.symbol.declNode(i, j)
      decls.push({ start: node.start, end: node.end })
    }
    symbols.push({
      id: i,
      name: semantic.symbol.name(i),
      scopeId: semantic.symbol.scopeId(i),
      decls,
      refs: [],
    })
  }
  const references = []
  for (let r = 0; r < semantic.reference.count; r++) {
    if (mode === 'runtime' && semantic.reference.inTypePosition(r)) continue
    const symbolId = semantic.reference.symbolId(r)
    const span = { start: semantic.reference.start(r), end: semantic.reference.end(r) }
    references.push({
      id: references.length,
      name: semantic.reference.name(r),
      scopeId: semantic.reference.scopeId(r),
      symbolId,
      space: semantic.reference.space(r),
      isWrite: semantic.reference.isWrite(r),
      ...span,
    })
    if (symbolId !== null && symbols[symbolId]) symbols[symbolId].refs.push(span)
  }
  const imports = []
  for (let i = 0; i < semantic.import.count; i++) {
    imports.push({
      id: i,
      kind: semantic.import.kind(i),
      name: semantic.import.name(i),
      specifier: semantic.import.specifier(i),
      symbolId: semantic.import.symbolId(i),
      typeOnly: semantic.import.typeOnly(i),
      phase: semantic.import.phase(i),
    })
  }
  const exports = []
  for (let i = 0; i < semantic.export.count; i++) {
    exports.push({
      id: i,
      kind: semantic.export.kind(i),
      name: semantic.export.name(i),
      fromName: semantic.export.fromName(i),
      specifier: semantic.export.specifier(i),
      symbolId: semantic.export.symbolId(i),
    })
  }
  return { scopes, symbols, references, imports, exports, moduleFlags: semantic.moduleFlags }
}

const NUMERIC_COLUMNS = new Set(['#', 'symbol', 'parent', 'span', 'declCount', 'refs'])

function tableHtml(head, rows) {
  const ths = head
    .map((label) => `<th${NUMERIC_COLUMNS.has(label) ? ' class="num"' : ''}>${escapeHtml(label)}</th>`)
    .join('')
  return `<div class="table-wrap"><table><thead><tr>${ths}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`
}

function renderTable(model, name) {
  const scopeLabel = (id) => (id === null ? 'null' : `${id} ${model.scopes[id]?.kind ?? ''}`)
  switch (name) {
    case 'reference':
      return tableHtml(
        ['#', 'name', 'scope', 'symbol', 'space', 'isWrite'],
        model.references.map(
          (ref) =>
            `<tr tabindex="0" data-st-row="reference" data-st-id="${ref.id}"${ref.symbolId === null ? ' class="st-row-unresolved"' : ''}>${idCell(ref.id)}<td><code>${escapeHtml(ref.name)}</code></td>${cell(scopeLabel(ref.scopeId))}${idCell(ref.symbolId)}${cell(ref.space)}${cell(ref.isWrite)}</tr>`,
        ),
      )
    case 'symbol':
      return tableHtml(
        ['#', 'name', 'scope', 'declCount', 'refs'],
        model.symbols.map(
          (symbol) =>
            `<tr tabindex="0" data-st-row="symbol" data-st-id="${symbol.id}">${idCell(symbol.id)}<td><code>${escapeHtml(symbol.name)}</code></td>${cell(scopeLabel(symbol.scopeId))}${idCell(symbol.decls.length)}${idCell(symbol.refs.length)}</tr>`,
        ),
      )
    case 'scope':
      return tableHtml(
        ['#', 'kind', 'parent', 'node', 'span'],
        model.scopes.map(
          (scope) =>
            `<tr tabindex="0" data-st-row="scope" data-st-id="${scope.id}">${idCell(scope.id)}${cell(scope.kind)}${idCell(scope.parentId)}<td><code>${escapeHtml(scope.nodeType)}</code></td><td class="num">${scope.start}:${scope.end}</td></tr>`,
        ),
      )
    case 'import':
      return tableHtml(
        ['#', 'kind', 'name', 'specifier', 'symbol', 'typeOnly', 'phase'],
        model.imports.map(
          (entry) =>
            `<tr>${idCell(entry.id)}${cell(entry.kind)}<td><code>${escapeHtml(entry.name)}</code></td>${cell(entry.specifier)}${idCell(entry.symbolId)}${cell(entry.typeOnly)}${cell(entry.phase)}</tr>`,
        ),
      )
    case 'export':
      return tableHtml(
        ['#', 'kind', 'name', 'fromName', 'specifier', 'symbol'],
        model.exports.map(
          (entry) =>
            `<tr>${idCell(entry.id)}${cell(entry.kind)}<td><code>${escapeHtml(entry.name)}</code></td>${cell(entry.fromName)}${cell(entry.specifier)}${idCell(entry.symbolId)}</tr>`,
        ),
      )
    default:
      return ''
  }
}

export default function mount(root, { cleanup }) {
  const { source: seed, unresolved, mode = 'all' } = JSON.parse(root.querySelector('[data-st-seed]').textContent)
  const host = root.querySelector('[data-st-source]')
  const out = root.querySelector('[data-st-out]')
  const tabs = root.querySelector('[data-st-tabs]')
  const readout = root.querySelector('[data-st-readout]')
  let active = 'reference'
  let segments = []
  let model = null
  let nodes = []
  let view = null
  let source = seed
  let editor = null
  let spans = []
  let run = 0
  const reset = root.querySelector('[data-st-reset]')

  const showTable = () => {
    for (const tab of tabs.querySelectorAll('[data-st-tab]')) {
      const selected = tab.dataset.stTab === active
      tab.setAttribute('aria-selected', String(selected))
      tab.tabIndex = selected ? 0 : -1
    }
    out.innerHTML = renderTable(model, active)
    if (active === 'reference') {
      const flags = Object.entries(model.moduleFlags)
        .map(([key, value]) => `${key}: ${value}`)
        .join(' · ')
      out.insertAdjacentHTML('beforeend', `<p class="ex-note st-flags">moduleFlags · ${escapeHtml(flags)}</p>`)
    }
  }

  const clearRows = () => {
    for (const row of out.querySelectorAll('[data-st-row]')) {
      row.classList.remove('ex-row-active')
      row.removeAttribute('aria-current')
    }
    clearClass(segments, 'ex-decl')
    clearClass(segments, 'ex-ref')
    clearClass(segments, 'ex-hit')
    clearClass(segments, 'ex-scope')
  }

  const selectRow = (row) => {
    clearRows()
    row.classList.add('ex-row-active')
    row.setAttribute('aria-current', 'true')
    const id = Number(row.dataset.stId)
    if (row.dataset.stRow === 'symbol') {
      const symbol = model.symbols[id]
      readout.textContent = `${symbol.name}: scope ${symbol.scopeId}, symbol ${symbol.id}.`
      paint(segments, model.symbols[id].decls, 'ex-decl')
      paint(segments, model.symbols[id].refs, 'ex-ref')
    } else if (row.dataset.stRow === 'reference') {
      const ref = model.references[id]
      readout.textContent =
        ref.symbolId === null
          ? `${ref.name}: no declaration in this file, symbolId is null.`
          : `${ref.name}: scope ${ref.scopeId}, symbol ${ref.symbolId}.`
      paint(segments, [ref], 'ex-hit')
      if (ref.symbolId !== null) paint(segments, model.symbols[ref.symbolId].decls, 'ex-decl')
    } else if (row.dataset.stRow === 'scope') {
      readout.textContent = `Scope ${id} is ${model.scopes[id].kind} and spans ${model.scopes[id].start}:${model.scopes[id].end}.`
      paint(segments, [model.scopes[id]], 'ex-scope')
    }
  }

  const describe = (offset) => {
    const ref = model?.references.find((candidate) => candidate.start <= offset && candidate.end > offset)
    if (ref?.symbolId === null) {
      readout.innerHTML = `<code>${escapeHtml(ref.name)}</code>: no declaration in this file, <code>symbolId</code> is null.`
      clearClass(segments, 'ex-scope')
      paint(segments, [ref], 'ex-hit')
      return
    }
    const entry = innermostAt(nodes, offset)
    if (!entry) return
    const index = view.indexOf(entry.node)
    clearClass(segments, 'ex-scope')
    if (index === undefined) {
      readout.textContent = `${entry.type} ${entry.start}:${entry.end} · not in the node table`
      return
    }
    const scopeId = view.semantic.nodeScope(index)
    const scope = model.scopes[scopeId]
    const text = source.slice(entry.start, entry.end).split('\n')[0]
    const symbol = model.symbols.find((candidate) =>
      [...candidate.decls, ...candidate.refs].some((span) => span.start <= offset && span.end > offset),
    )
    const name = `<code>${escapeHtml(text.length > 24 ? `${text.slice(0, 24)}…` : text)}</code>`
    const where = `scope ${scopeId} <code>${escapeHtml(scope?.kind ?? '?')}</code>`
    readout.innerHTML = symbol
      ? `${name}: ${where}, symbol ${symbol.id} <code>${escapeHtml(symbol.name)}</code>.`
      : `${name}: no declaration in this file, symbolId is null (${where}).`
    if (scope) paint(segments, [scope], 'ex-scope')
  }

  tabs.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-st-tab]')
    if (!chip || !model) return
    active = chip.dataset.stTab
    showTable()
    clearRows()
  })
  tabs.addEventListener('keydown', (event) => {
    const current = event.target.closest('[data-st-tab]')
    if (!current) return
    const all = [...tabs.querySelectorAll('[data-st-tab]')]
    const index = all.indexOf(current)
    const next = event.key === 'ArrowRight' ? all[(index + 1) % all.length] : event.key === 'ArrowLeft' ? all[(index - 1 + all.length) % all.length] : null
    if (!next) return
    event.preventDefault()
    next.focus()
    next.click()
  })
  out.addEventListener('click', (event) => {
    const row = event.target.closest('[data-st-row]')
    if (row) selectRow(row)
  })
  out.addEventListener('mouseover', (event) => {
    const row = event.target.closest('[data-st-row]')
    if (row) selectRow(row)
  })
  out.addEventListener('focusin', (event) => {
    const row = event.target.closest('[data-st-row]')
    if (row) selectRow(row)
  })
  out.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const row = event.target.closest('[data-st-row]')
    if (!row) return
    event.preventDefault()
    selectRow(row)
  })
  host.addEventListener('mouseover', (event) => {
    const segment = event.target.closest('.ex-seg')
    if (segment && view) describe(Number(segment.dataset.start))
  })
  host.addEventListener('focusin', (event) => {
    const segment = event.target.closest('.ex-seg')
    if (segment && view) describe(Number(segment.dataset.start))
  })
  host.addEventListener('mouseleave', () => {
    if (!view) return
    readout.textContent = IDLE_READOUT
    clearClass(segments, 'ex-scope')
  })

  const decorate = (mirror) => {
    markRanges(mirror, [{ start: 0, end: source.length }, ...spans], 'ex-seg')
    segments = readSegments(mirror)
    const missing = model?.references.filter((ref) => ref.symbolId === null) ?? []
    paint(segments, missing, 'ex-unresolved')
    for (const segment of segments) {
      if (segment.node.classList.contains('ex-unresolved')) {
        segment.node.title = 'No declaration in this file; symbolId is null'
      }
    }
  }

  const showResult = async (result) => {
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    if (errors.length > 0) {
      out.innerHTML = `<ul class="explorer-diagnostics ex-errors">${errors
        .map((error) => `<li>${escapeHtml(error.message)}</li>`)
        .join('')}</ul>`
      reportStatus(root, `${plural(errors.length, 'analysis error')} · runs in your browser`)
      root.dataset.widgetState = 'error'
      return
    }
    view = result
    model = readModel(result, mode)
    nodes = collectNodes(result.program)
    spans = [
      ...model.references.map((ref) => ({
        ...ref,
        readout:
          ref.symbolId === null
            ? `${ref.name}: no declaration in this file, symbolId is null.`
            : `${ref.name}: scope ${ref.scopeId}, symbol ${ref.symbolId}.`,
      })),
      ...model.scopes,
    ]
    for (const symbol of model.symbols) spans.push(...symbol.decls)
    await editor.render()
    const missing = model.references.filter((ref) => ref.symbolId === null)
    const counts = {
      reference: model.references.length,
      symbol: model.symbols.length,
      scope: model.scopes.length,
      import: model.imports.length,
      export: model.exports.length,
    }
    for (const [name, count] of Object.entries(counts)) {
      tabs.querySelector(`[data-st-count="${name}"]`).textContent = String(count)
    }
    showTable()
    const first = out.querySelector('.st-row-unresolved')
    if (first) {
      first.classList.add('ex-row-active')
      first.setAttribute('aria-current', 'true')
    }
    const summary = missing.length
      ? `${plural(missing.length, 'name')} resolves to nothing: ${missing.map((ref) => ref.name).join(', ')}`
      : 'Every name resolves to a declaration.'
    plainStatus(root, summary, result.ms, 'analyzed')
    root.dataset.widgetState =
      source !== seed || missing.map((ref) => ref.name).join(',') === unresolved.join(',') ? 'ready' : 'error'
  }

  const runAnalysis = async () => {
    const ticket = ++run
    try {
      const result = await analyze(source, ANALYZE_OPTIONS)
      if (ticket === run) await showResult(result)
    } catch (error) {
      out.innerHTML = `<p class="ex-note ex-unavailable">in-browser analyzer unavailable: ${escapeHtml(
        error?.message ?? String(error),
      )}</p>`
      failWidget(root, 'in-browser analyzer unavailable', error, 'unavailable')
    }
  }

  cleanup.push(() => {
    view = null
    editor?.dispose()
  })

  ready()
    .then(() => {
      editor = createLayeredEditor({
        host,
        source,
        render: (value) => highlightedHtml(value, 'ex-source ex-source-plain'),
        afterRender: decorate,
        onChange(value) {
          source = value
          reset.hidden = source === seed
          runAnalysis()
        },
        onPointerOffset: (_target, offset) => describe(offset),
        onClickOffset: describe,
        onFocusOffset: describe,
        ariaLabel: 'Editable semantic source',
        rows: Math.min(Math.max(seed.split('\n').length, 6), 30),
      })
      reset.addEventListener('click', async () => {
        source = seed
        reset.hidden = true
        await editor.setValue(source)
        runAnalysis()
      })
      return runAnalysis()
    })
    .catch((error) => {
      out.innerHTML = `<p class="ex-note ex-unavailable">in-browser analyzer unavailable: ${escapeHtml(error.message)}</p>`
      failWidget(root, 'in-browser analyzer unavailable', error, 'unavailable')
    })
}
