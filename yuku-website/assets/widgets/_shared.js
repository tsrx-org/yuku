// Pieces the registry widgets share: the flat node list behind every tree
// pane, the tree markup, and the source pane with diagnostic underlines.
// Nothing here calls the engine.
import { escapeHtml, formatMs, plural } from '../yuku-shared.js'

const MAX_TREE_DEPTH = 12
let highlighterPromise = null

document.addEventListener('input', (event) => {
  const editor = event.target.closest?.('.widget .ex-editor')
  const button = editor?.closest('.widget')?.querySelector('.try-button')
  if (button) button.dataset.code = editor.value
})
document.addEventListener('click', (event) => {
  const widget = event.target.closest?.('.widget')
  if (!widget?.querySelector('.try-button')) return
  queueMicrotask(() => {
    const editor = widget.querySelector('.ex-editor')
    const button = widget.querySelector('.try-button')
    if (editor && button) button.dataset.code = editor.value
  })
})

const firstLoad = () =>
  document.documentElement.dataset.afterFirstLoad === 'true'
    ? Promise.resolve()
    : new Promise((resolve) => window.addEventListener('yuku-after-first-load', resolve, { once: true }))

export async function highlighter() {
  await firstLoad()
  highlighterPromise ??= import(
    new URL(`../demo-highlighter.js${document.documentElement.dataset.assetVersion}`, import.meta.url)
  ).then((module) => module.createDemoHighlighter())
  return highlighterPromise
}

function highlightedDocument(html, preClass) {
  const template = document.createElement('template')
  template.innerHTML = html
  const pre = template.content.firstElementChild
  pre.classList.add(...preClass.split(' ').filter(Boolean))
  return { pre, code: pre.querySelector('code') }
}

export async function highlightedHtml(source, preClass, lang = 'tsrx') {
  const { pre } = highlightedDocument((await highlighter()).highlight(source, lang), preClass)
  return pre.outerHTML
}

export async function highlightedCode(source, lang = 'tsrx') {
  const { code } = highlightedDocument((await highlighter()).highlight(source, lang), '')
  return code.innerHTML
}

export function walkNodes(program) {
  const out = []
  const isNode = (value) =>
    value !== null &&
    typeof value === 'object' &&
    typeof value.type === 'string' &&
    typeof value.start === 'number'
  const visit = (node, depth) => {
    out.push({ type: node.type, start: node.start, end: node.end, depth })
    for (const [key, value] of Object.entries(node)) {
      if (key === 'comments') continue
      if (Array.isArray(value)) {
        for (const child of value) if (isNode(child)) visit(child, depth + 1)
      } else if (isNode(value)) {
        visit(value, depth + 1)
      }
    }
  }
  visit(program, 0)
  return out
}

export function treeHtml(nodes, attribute = 'data-ct-tree') {
  let html = ''
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    if (node.depth > MAX_TREE_DEPTH) continue
    html += `<li class="ex-tree-row" style="--ex-depth:${node.depth}"><button type="button" tabindex="-1"><code>${escapeHtml(node.type)}</code> <span class="explorer-span">${node.start}:${node.end}</span></button></li>`
    if (node.depth === MAX_TREE_DEPTH) {
      let deeper = 0
      for (let j = i + 1; j < nodes.length && nodes[j].depth > MAX_TREE_DEPTH; j++) deeper++
      if (deeper > 0) {
        html += `<li class="ex-tree-more" style="--ex-depth:${node.depth + 1}">… ${plural(deeper, 'deeper node')}</li>`
      }
    }
  }
  return `<ul class="ex-tree" ${attribute}>${html}</ul>`
}

export function diagnosticsHtml(diagnostics) {
  if (diagnostics.length === 0) return ''
  return `<ul class="wd-diagnostics">${diagnostics
    .map(
      (diagnostic) =>
        `<li><code class="wd-severity wd-${diagnostic.severity === 'error' ? 'error' : 'warning'}">${escapeHtml(diagnostic.severity)}</code> ${escapeHtml(diagnostic.message)} <span class="explorer-span">${diagnostic.start}:${diagnostic.end}</span>${
          diagnostic.help ? `<span class="wd-help">help: ${escapeHtml(diagnostic.help)}</span>` : ''
        }</li>`,
    )
    .join('')}</ul>`
}

export const parseStatus = (result) =>
  `parsed in ${formatMs(result.ms)} ms · ${plural(result.nodeCount, 'node')} · ${plural(result.diagnostics.length, 'diagnostic')} · runs in your browser`

export function plainStatus(root, sentence, ms, verb = 'parsed') {
  const status = root.querySelector('[data-widget-status], [data-ex-status]')
  if (!status) return
  const timing = Number.isFinite(ms) ? `${verb} in ${formatMs(ms)} ms · ` : ''
  status.innerHTML = `${escapeHtml(sentence)} <span class="ex-status-meta">${escapeHtml(timing)}runs in your browser</span>`
}
