import { escapeHtml, plural } from '../yuku-shared.js'
import { parse, ready } from '../yuku-wasm.js'
import { createLayeredEditor } from './_editor.js'
import { highlightedHtml, plainStatus } from './_shared.js'
import { clearClass, collectNodes, failWidget, markRanges, paint, readSegments } from './_source-pane.js'

const PARSE_OPTIONS = { lang: 'tsx', sourceType: 'module' }

const visitorCode = (type, hits) =>
  `walk(program, {\n  ${type}(node) {\n    hits.push([node.start, node.end]);\n  },\n});\n// hits.length === ${hits}`

export default function mount(root, { cleanup }) {
  const { source: seed, landing } = JSON.parse(root.querySelector('[data-vi-seed]').textContent)
  const host = root.querySelector('[data-vi-source]')
  const out = root.querySelector('[data-vi-out]')
  const select = root.querySelector('[data-vi-type]')
  const reset = root.querySelector('[data-vi-reset]')
  const readout = root.querySelector('[data-vi-readout]')
  let source = seed
  let editor = null
  let segments = []
  let nodes = []
  let matches = []
  let ms = 0
  let run = 0

  const describe = (entry) => {
    if (entry) readout.textContent = `${entry.type} spans ${entry.start}:${entry.end}.`
  }

  const decorate = (mirror) => {
    markRanges(
      mirror,
      [{ start: 0, end: source.length }, ...nodes.map((entry) => ({ ...entry, readout: `${entry.type} spans ${entry.start}:${entry.end}.` }))],
      'ex-seg',
    )
    segments = readSegments(mirror)
    paint(segments, matches, 'ex-hit')
  }

  const show = async (type) => {
    matches = nodes.filter((entry) => entry.type === type)
    await editor.render()
    out.innerHTML =
      `${await highlightedHtml(visitorCode(type, matches.length), 'ex-generated vi-code')}` +
      `<ul class="vi-hits" data-vi-hits>${matches
        .map(
          (entry, index) =>
            `<li><button type="button" data-vi-hit="${index}"><code>${escapeHtml(type)}</code> <span class="explorer-span">${entry.start}:${entry.end}</span></button></li>`,
        )
        .join('')}</ul>`
    plainStatus(root, `${plural(matches.length, `${type} node`)} highlighted.`, ms)
  }

  const reparse = async () => {
    const ticket = ++run
    try {
      const result = await parse(source, PARSE_OPTIONS)
      if (ticket !== run) return
      ms = result.ms
      nodes = collectNodes(result.program)
      const counts = new Map()
      for (const entry of nodes) counts.set(entry.type, (counts.get(entry.type) ?? 0) + 1)
      const types = [...counts.keys()].sort()
      const selected = counts.has(select.value) ? select.value : counts.has(landing) ? landing : types[0]
      select.innerHTML = types
        .map((type) => `<option value="${escapeHtml(type)}"${type === selected ? ' selected' : ''}>${escapeHtml(type)} (${counts.get(type)})</option>`)
        .join('')
      select.disabled = false
      await show(selected)
      root.dataset.widgetState = 'ready'
    } catch (error) {
      out.innerHTML = `<p class="ex-note ex-unavailable">parse failed: ${escapeHtml(error?.message ?? String(error))}</p>`
      failWidget(root, 'parse failed', error)
    }
  }

  select.addEventListener('change', () => show(select.value))
  out.addEventListener('mouseover', (event) => {
    const button = event.target.closest('[data-vi-hit]')
    if (!button) return
    const entry = matches[Number(button.dataset.viHit)]
    clearClass(segments, 'ex-hit')
    paint(segments, [entry], 'ex-hit')
    describe(entry)
  })
  out.addEventListener('focusin', (event) => {
    const button = event.target.closest('[data-vi-hit]')
    if (button) describe(matches[Number(button.dataset.viHit)])
  })
  out.addEventListener('click', (event) => {
    const button = event.target.closest('[data-vi-hit]')
    if (button) describe(matches[Number(button.dataset.viHit)])
  })
  out.addEventListener('mouseleave', () => {
    clearClass(segments, 'ex-hit')
    paint(segments, matches, 'ex-hit')
  })

  cleanup.push(() => editor?.dispose())

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
          reparse()
        },
        onPointerOffset: (target, offset) => {
          const segment = target?.closest('.ex-seg')
          const at = Number(segment?.dataset.start ?? offset)
          describe(matches.find((entry) => entry.start <= at && entry.end > at) ?? nodes.find((entry) => entry.start <= at && entry.end > at))
        },
        onClickOffset: (offset) => describe(matches.find((entry) => entry.start <= offset && entry.end > offset)),
        onFocusOffset: (offset) => describe(matches.find((entry) => entry.start <= offset && entry.end > offset)),
        ariaLabel: 'Editable visitor source',
        rows: Math.min(Math.max(seed.split('\n').length, 6), 30),
      })
      reset.addEventListener('click', async () => {
        source = seed
        reset.hidden = true
        await editor.setValue(seed)
        reparse()
      })
      return reparse()
    })
    .catch((error) => {
      out.innerHTML = `<p class="ex-note ex-unavailable">in-browser parser unavailable: ${escapeHtml(error?.message ?? String(error))}</p>`
      failWidget(root, 'in-browser parser unavailable', error, 'unavailable')
    })
}
