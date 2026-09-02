// Doc-page components that are plain DOM: no engine, no wasm, no network. They
// are loaded on demand by app.js only when a page contains one, so the home
// page and the playground never pay for them. Every init is idempotent via
// data-ready, because an SPA navigation can run it again over markup that is
// already wired.
//
// Both components are progressive: without this file the chooser shows every
// answer under its own label, and the matrix shows every row. What the file
// adds is the ability to see one at a time.

function initMatrixFilters() {
  for (const filter of document.querySelectorAll('[data-matrix-filter]:not([data-ready])')) {
    filter.dataset.ready = '1'
    const chips = [...filter.querySelectorAll('[data-matrix-chip]')]
    const rows = [...filter.querySelectorAll('tr[data-classification]')]
    const status = filter.querySelector('[data-matrix-status]')
    const noun = filter.dataset.matrixNoun ?? 'rows'
    const select = (slug) => {
      let shown = 0
      for (const chip of chips) {
        chip.setAttribute('aria-pressed', String(chip.dataset.matrixChip === slug))
      }
      for (const row of rows) {
        row.hidden = slug !== 'all' && row.dataset.classification !== slug
        if (!row.hidden) shown += 1
      }
      if (status) {
        status.textContent =
          shown === rows.length
            ? `Showing all ${shown} ${noun}.`
            : `Showing ${shown} of ${rows.length} ${noun}.`
      }
    }
    for (const chip of chips) {
      chip.addEventListener('click', () => select(chip.dataset.matrixChip))
    }
    select('all')
  }
}

function initChoosers() {
  for (const chooser of document.querySelectorAll('[data-chooser]:not([data-ready])')) {
    chooser.dataset.ready = '1'
    const options = [...chooser.querySelectorAll('[data-chooser-option]')]
    const panels = [...chooser.querySelectorAll('[data-chooser-panel]')]
    const select = (index) => {
      for (const option of options) {
        option.setAttribute('aria-pressed', String(option.dataset.chooserOption === index))
      }
      for (const panel of panels) panel.hidden = panel.dataset.chooserPanel !== index
    }
    for (const option of options) {
      option.addEventListener('click', () => select(option.dataset.chooserOption))
    }
    // Without JS every answer is on the page at once; with JS the reader picks
    // theirs, so start on the first rather than on nothing.
    select(options[0].dataset.chooserOption)
  }
}

export function init() {
  initMatrixFilters()
  initChoosers()
}
