// Runs either the compact printer or the full comparison in this tab.
import { escapeHtml, plural } from '../yuku-shared.js'
import { generate, ready } from '../yuku-wasm.js'
import { createLayeredEditor } from './_editor.js'
import { highlightedCode, highlightedHtml, plainStatus } from './_shared.js'
import { bindMarkedReadout, failWidget } from './_source-pane.js'

const PARSE_OPTIONS = { lang: 'tsx', sourceType: 'module', attachComments: true }
const DEFAULTS = { format: 'pretty', indent: 2, quotes: 'preserve', comments: 'some', strip: false, minify: false }
const SHORTEST_TITLE =
  'not available: the Quotes enum in src/dialect/codegen.zig has preserve, double and single, so shortest cannot be requested'

function equivalentCall(state) {
  const parts = []
  if (state.format !== DEFAULTS.format) parts.push(`format: "${state.format}"`)
  if (state.format === 'pretty' && state.indent !== DEFAULTS.indent) parts.push(`indent: ${state.indent}`)
  if (state.quotes !== DEFAULTS.quotes) parts.push(`quotes: "${state.quotes}"`)
  if (state.comments !== DEFAULTS.comments) parts.push(`comments: "${state.comments}"`)
  if (state.strip) parts.push('strip: true')
  if (state.minify) parts.push('minify: { syntax: true }')
  return `generate(program, {${parts.length ? ` ${parts.join(', ')} ` : ''}})`
}

const labels = { format: 'Format', quotes: 'Quotes', comments: 'Comments' }
const valueLabels = { preserve: 'As written', pretty: 'Pretty', compact: 'Compact' }
const chips = (name, values, selected, disabled = {}) =>
  `<div class="ex-chip-group" role="group" aria-label="${labels[name]}"><span class="ex-chip-label">${labels[name]}</span>${values
    .map(
      (value) =>
        `<button type="button" data-gd-option="${name}" data-gd-value="${value}" aria-pressed="${value === selected}"${
          disabled[value] ? ' disabled' : ''
        } title="${escapeHtml(disabled[value] ?? `${name}=${value}`)}">${valueLabels[value] ?? value[0].toUpperCase() + value.slice(1)}</button>`,
    )
    .join('')}</div>`

function quickControlsHtml(state) {
  const keepComments = state.comments !== 'none'
  return (
    `<button type="button" role="switch" title="strip" data-gd-flag="strip" aria-checked="${state.strip}">Strip types</button>` +
    `<button type="button" role="switch" title="compact format and syntax minification" data-gd-flag="minify" aria-checked="${state.minify}">Minify</button>` +
    `<div class="ex-chip-group" role="group" aria-label="Comments"><span class="ex-chip-label">Comments</span>` +
    `<button type="button" data-gd-quick="comments" data-gd-value="keep" aria-pressed="${keepComments}">Keep</button>` +
    `<button type="button" data-gd-quick="comments" data-gd-value="drop" aria-pressed="${!keepComments}">Drop</button></div>` +
    `<div class="ex-chip-group" role="group" aria-label="Quotes"><span class="ex-chip-label">Quotes</span>` +
    ['preserve', 'double', 'single']
      .map(
        (value) =>
          `<button type="button" data-gd-quick="quotes" data-gd-value="${value}" aria-pressed="${state.quotes === value}">${valueLabels[value] ?? value[0].toUpperCase() + value.slice(1)}</button>`,
      )
      .join('') +
    '</div>'
  )
}

function advancedControlsHtml(state) {
  return (
    chips('format', ['pretty', 'compact'], state.format) +
    `<div class="ex-chip-group"><span class="ex-chip-label">Indent</span><input title="indent" type="number" min="0" max="8" step="1" value="${state.indent}" data-gd-indent aria-label="Spaces per indentation level"${
      state.format === 'compact' ? ' disabled' : ''
    }></div>` +
    chips('quotes', ['preserve', 'double', 'single', 'shortest'], state.quotes, { shortest: SHORTEST_TITLE }) +
    chips('comments', ['none', 'all', 'some', 'line', 'block'], state.comments)
  )
}

// Longest-common-subsequence line diff; the outputs are a few dozen lines.
export function diffLines(a, b) {
  const n = a.length
  const m = b.length
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
    }
  }
  const out = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      out.push({ kind: 'del', text: a[i++] })
    } else {
      out.push({ kind: 'add', text: b[j++] })
    }
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] })
  while (j < m) out.push({ kind: 'add', text: b[j++] })
  return out
}

async function diffHtml(rows) {
  const marks = { same: ' ', del: '-', add: '+' }
  const lines = await Promise.all(
    rows.map(
      async (row) =>
        `<span class="gd-line gd-${row.kind}" data-gd-line="${row.kind}"${row.kind === 'same' ? '' : ` tabindex="0" data-readout="${row.kind === 'add' ? 'Added in output B.' : 'Removed from output B.'}"`}><span class="gd-mark">${marks[row.kind]}</span>${await highlightedCode(row.text)}</span>`,
    ),
  )
  return `<pre class="ex-generated gd-diff"><code>${lines.join('\n')}</code></pre>`
}

export default function mount(root, { cleanup }) {
  const { source: seed, landing, full } = JSON.parse(root.querySelector('[data-gd-seed]').textContent)
  let source = seed
  const state = { a: { ...DEFAULTS, ...landing.a }, b: { ...DEFAULTS, ...landing.b } }
  const outputs = { a: null, b: null }
  let run = 0
  let disposed = false
  let editor = null
  const reset = root.querySelector('[data-gd-reset]')

  const side = (id) => ({
    controls: root.querySelector(`[data-gd-controls="${id}"]`),
    out: root.querySelector(`[data-gd-out="${id}"]`),
    call: root.querySelector(`[data-gd-call="${id}"]`),
  })
  const diffHost = root.querySelector('[data-gd-diff]')
  const advanced = root.querySelector('[data-gd-advanced]')

  const renderControls = () => {
    side('b').controls.innerHTML = quickControlsHtml(state.b)
    if (full && advanced) advanced.innerHTML = advancedControlsHtml(state.b)
  }

  const renderDiff = async () => {
    if (outputs.a === null || outputs.b === null) return
    const rows = diffLines(outputs.a.split('\n'), outputs.b.split('\n'))
    const changed = rows.filter((row) => row.kind !== 'same').length
    diffHost.innerHTML = changed
      ? await diffHtml(rows)
      : '<p class="ex-note" data-gd-line="none">A and B print the same text.</p>'
    return changed
  }

  const runSide = async (id) => {
    const { out, call } = side(id)
    const options = state[id]
    let result
    try {
      result = await generate(source, PARSE_OPTIONS, {
        strip: options.strip,
        minify: options.minify ? { syntax: true } : false,
        format: options.format,
        quotes: options.quotes,
        comments: options.comments,
        indent: options.indent,
      })
    } catch (error) {
      out.innerHTML = `<p class="ex-note ex-unavailable">generate failed: ${escapeHtml(error.message)}</p>`
      outputs[id] = null
      throw error
    }
    outputs[id] = result.code
    const errors = result.errors.length
      ? `<ul class="explorer-diagnostics ex-errors">${result.errors
          .map((error) => `<li>${escapeHtml(error.message)} <span class="explorer-span">${error.start}:${error.end}</span></li>`)
          .join('')}</ul>`
      : ''
    out.innerHTML = `${errors}${await highlightedHtml(result.code, 'ex-generated')}`
    out.querySelector('.ex-generated')?.setAttribute('data-gd-generated', id)
    call.innerHTML = `<code>${escapeHtml(equivalentCall(options))}</code>`
    return result
  }

  const runAll = async () => {
    const ticket = ++run
    try {
      const [a, b] = await Promise.all([runSide('a'), runSide('b')])
      if (ticket !== run || disposed) return
      const changed = await renderDiff()
      plainStatus(root, `${plural(changed, 'line')} ${changed === 1 ? 'differs' : 'differ'} between outputs A and B.`, a.ms + b.ms, 'generated')
      root.dataset.widgetState = 'ready'
    } catch (error) {
      if (ticket !== run || disposed) return
      failWidget(root, 'generate failed', error)
    }
  }

  root.addEventListener('click', (event) => {
    const chip = event.target.closest('[data-gd-option]')
    if (chip && !chip.disabled) {
      state.b[chip.dataset.gdOption] = chip.dataset.gdValue
      renderControls()
      runAll()
      return
    }
    const quick = event.target.closest('[data-gd-quick]')
    if (quick) {
      state.b[quick.dataset.gdQuick] = quick.dataset.gdQuick === 'comments'
        ? quick.dataset.gdValue === 'keep' ? 'all' : 'none'
        : quick.dataset.gdValue
      renderControls()
      runAll()
      return
    }
    const flag = event.target.closest('[data-gd-flag]')
    if (flag) {
      const enabled = flag.getAttribute('aria-checked') !== 'true'
      if (flag.dataset.gdFlag === 'minify') {
        state.b.format = enabled ? 'compact' : 'pretty'
        state.b.minify = enabled
      } else {
        state.b[flag.dataset.gdFlag] = enabled
      }
      renderControls()
      runAll()
    }
  })
  root.addEventListener('change', (event) => {
    if (event.target.matches('[data-gd-indent]')) {
      const value = Number(event.target.value)
      state.b.indent = Number.isFinite(value) ? Math.min(Math.max(Math.round(value), 0), 8) : 2
      event.target.value = String(state.b.indent)
    } else {
      return
    }
    runAll()
  })

  cleanup.push(() => {
    disposed = true
    editor?.dispose()
  })

  bindMarkedReadout(root.querySelector('[data-gd-diff]'), root.querySelector('[data-gd-readout]'), 'Focus or hover a changed line to read the difference.')

  ready()
    .then(() => {
      renderControls()
      editor = createLayeredEditor({
        host: root.querySelector('[data-gd-source]'),
        source,
        render: (value) => highlightedHtml(value, 'ex-source ex-source-plain'),
        onChange(value) {
          source = value
          reset.hidden = source === seed
          runAll()
        },
        ariaLabel: 'Editable generator source',
        rows: Math.min(Math.max(seed.split('\n').length, 6), 30),
      })
      reset.addEventListener('click', async () => {
        source = seed
        reset.hidden = true
        await editor.setValue(seed)
        runAll()
      })
      return runAll()
    })
    .catch((error) => {
      for (const id of ['a', 'b']) {
        side(id).out.innerHTML = `<p class="ex-note ex-unavailable">in-browser generator unavailable: ${escapeHtml(
          error?.message ?? String(error),
        )}</p>`
      }
      failWidget(root, 'in-browser generator unavailable', error, 'unavailable')
    })
}
