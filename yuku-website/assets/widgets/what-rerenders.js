import { escapeHtml } from '../yuku-shared.js'
import { analyze, ready } from '../yuku-wasm.js'
import { createLayeredEditor } from './_editor.js'
import { rerenderModel } from './_what-rerenders.js'
import { diagnosticsHtml, highlightedHtml } from './_shared.js'
import { markRanges } from './_source-pane.js'

const OPTIONS = { lang: 'tsx', sourceType: 'module' }

export default function mount(root, { cleanup }) {
  const { source: seed } = JSON.parse(root.querySelector('[data-wr-seed]').textContent)
  const host = root.querySelector('[data-wr-source]')
  const out = root.querySelector('[data-wr-out]')
  const readout = root.querySelector('[data-wr-readout]')
  const status = root.querySelector('[data-widget-status]')
  let source = seed
  let model = null
  let selected = null
  let editor
  let run = 0
  let paintRun = 0
  let disposed = false

  const paintSource = (mirror) => {
    if (!model) return
    markRanges(mirror, model.clickable.map((span) => ({
      ...span,
      tag: 'mark',
      className: span.symbolId === selected?.symbolId ? 'wr-selected' : '',
      readout: `Select ${span.name}`,
    })), 'wr-name')
  }

  const show = async (symbolId) => {
    if (!model || symbolId === null) return
    selected = model.select(symbolId)
    const ticket = ++paintRun
    const sourceTicket = run
    out.innerHTML = await highlightedHtml(source, 'ex-generated wr-output')
    if (ticket !== paintRun || sourceTicket !== run || disposed) return
    markRanges(out, selected.places.map((place) => ({ ...place, tag: 'mark', readout: place.label })), 'wr-change')
    out.querySelector('.ex-generated')?.setAttribute('data-wr-generated', '')
    readout.textContent = selected.readout
    status.textContent = selected.readout
    root.dataset.selected = selected.name
    root.dataset.places = String(selected.places.length)
    root.dataset.widgetState = 'ready'
    editor?.render()
  }

  const selectAt = (offset) => {
    const span = model?.clickable.find((candidate) => candidate.start <= offset && candidate.end >= offset)
    if (span && span.symbolId !== selected?.symbolId) show(span.symbolId)
  }

  const refresh = async () => {
    const ticket = ++run
    try {
      const view = await analyze(source, OPTIONS)
      if (ticket !== run || disposed) return
      const errors = view.diagnostics.filter((item) => item.severity === 'error')
      if (errors.length) {
        out.innerHTML = diagnosticsHtml(view.diagnostics)
        status.textContent = 'Source does not analyze cleanly'
        root.dataset.widgetState = 'error'
        return
      }
      model = rerenderModel(view, source)
      const next = model.symbol(selected?.name ?? 'items') ?? model.symbol('items')
      await show(next)
    } catch (error) {
      if (ticket !== run || disposed) return
      out.innerHTML = `<p class="ex-note ex-unavailable">analyze failed: ${escapeHtml(error.message)}</p>`
      status.textContent = `analyze failed: ${error.message}`
      root.dataset.widgetState = 'error'
    }
  }

  cleanup.push(() => { disposed = true; editor?.dispose() })
  host.addEventListener('focusin', (event) => {
    const mark = event.target.closest?.('[data-start]')
    if (mark) selectAt(Number(mark.dataset.start))
  })
  ready().then(() => {
    editor = createLayeredEditor({
      host,
      source: seed,
      render: (value) => highlightedHtml(value, 'ex-source ex-source-plain'),
      onChange(value) { source = value; refresh() },
      onPointerOffset(_target, offset) { selectAt(offset) },
      onClickOffset: selectAt,
      onFocusOffset: selectAt,
      afterRender: paintSource,
      ariaLabel: 'Editable TSRX dependency source',
      rows: seed.split('\n').length,
    })
    return refresh()
  }).catch((error) => {
    status.textContent = `in-browser analyzer unavailable: ${error.message}`
    root.dataset.widgetState = 'unavailable'
  })
}
