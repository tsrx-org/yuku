import { escapeHtml } from '../yuku-shared.js'
import { generate as generateSource, parse, ready } from '../yuku-wasm.js'
import { createLayeredEditor } from './_editor.js'
import { generatedSource, lowerProgram } from './_lower-to-tsx.js'
import { diagnosticsHtml, highlightedHtml } from './_shared.js'

const OPTIONS = { lang: 'tsx', sourceType: 'module' }
const PRINT = { format: 'pretty', indent: 2 }

async function generate(program, options) {
  return generateSource(generatedSource(program), OPTIONS, options)
}

export default function mount(root, { cleanup }) {
  const { source: seed } = JSON.parse(root.querySelector('[data-lt-seed]').textContent)
  const host = root.querySelector('[data-lt-source]')
  const out = root.querySelector('[data-lt-out]')
  const readout = root.querySelector('[data-lt-readout]')
  const note = root.querySelector('[data-lt-note]')
  const status = root.querySelector('[data-widget-status]')
  const reset = root.querySelector('[data-lt-reset]')
  let editor
  let run = 0
  let disposed = false

  const lower = async (source) => {
    const ticket = ++run
    try {
      const parsed = await parse(source, OPTIONS)
      if (ticket !== run || disposed) return
      const errors = parsed.diagnostics.filter((item) => item.severity === 'error')
      if (errors.length) {
        out.innerHTML = diagnosticsHtml(parsed.diagnostics)
        status.textContent = errors[0].message
        root.dataset.widgetState = 'error'
        return
      }
      const lowered = lowerProgram(parsed.program, source)
      const printed = await generate(lowered.program, PRINT)
      if (ticket !== run || disposed) return
      if (printed.errors.length) throw new Error(printed.errors[0].message)
      const checked = await parse(printed.code, OPTIONS)
      if (ticket !== run || disposed) return
      const outputError = checked.diagnostics.find((item) => item.severity === 'error')
      out.innerHTML = await highlightedHtml(printed.code, 'ex-generated lt-output', 'tsx')
      if (ticket !== run || disposed) return
      out.querySelector('.ex-generated')?.setAttribute('data-lt-generated', '')
      readout.textContent = `${lowered.constructs} constructs lowered`
      note.hidden = lowered.styles === 0
      note.textContent = lowered.styles === 1 ? '<style> block dropped' : `${lowered.styles} <style> blocks dropped`
      status.textContent = outputError ? outputError.message : 'output parses'
      root.dataset.constructs = String(lowered.constructs)
      root.dataset.outputParses = String(!outputError)
      root.dataset.widgetState = outputError ? 'error' : 'ready'
    } catch (error) {
      if (ticket !== run || disposed) return
      out.innerHTML = `<p class="ex-note ex-unavailable">lowering failed: ${escapeHtml(error.message)}</p>`
      status.textContent = `lowering failed: ${error.message}`
      root.dataset.widgetState = 'error'
    }
  }

  cleanup.push(() => { disposed = true; editor?.dispose() })
  ready().then(() => {
    editor = createLayeredEditor({
      host,
      source: seed,
      render: (source) => highlightedHtml(source, 'ex-source ex-source-plain'),
      onChange(source) { reset.hidden = source === seed; lower(source) },
      ariaLabel: 'Editable TSRX lowering source',
      rows: seed.split('\n').length,
    })
    reset.addEventListener('click', async () => {
      reset.hidden = true
      await editor.setValue(seed)
      lower(seed)
    })
    return lower(seed)
  }).catch((error) => {
    status.textContent = `in-browser generator unavailable: ${error.message}`
    root.dataset.widgetState = 'unavailable'
  })
}
