// Runtime half of yuku-website/widgets/api-from-dts.mjs: every entry is a closed
// <details> at rest; the filter opens what matches and hides the rest, and a
// #api-NAME hash opens that one entry.
export default function mount(root, { cleanup }) {
  const input = root.querySelector('[data-api-filter]')
  const count = root.querySelector('[data-api-count]')
  const status = root.querySelector('[data-widget-status]')
  const entries = [...root.querySelectorAll('[data-api-entry]')].map((element) => ({
    element,
    haystack: `${element.dataset.apiName} ${element.textContent}`.toLowerCase(),
  }))
  const groups = [...root.querySelectorAll('[data-api-group]')]
  let pinned = null

  const apply = () => {
    const query = input.value.trim().toLowerCase()
    let shown = 0
    for (const entry of entries) {
      const visible = query === '' || entry.haystack.includes(query)
      entry.element.hidden = !visible
      entry.element.open = query === '' ? entry.element === pinned : visible
      if (visible) shown++
    }
    for (const group of groups) {
      group.hidden = ![...group.querySelectorAll('[data-api-entry]')].some((entry) => !entry.hidden)
      if (!group.hidden && query !== '') group.open = true
    }
    count.textContent = query === '' ? `${entries.length} exports` : `${shown} of ${entries.length} exports`
    if (status) status.textContent = query === '' ? `${entries.length} exports, read from index.d.ts at build; open one to read it` : `showing ${shown} of ${entries.length} exports matching “${input.value.trim()}”`
  }

  const openFromHash = () => {
    const hash = decodeURIComponent(location.hash.slice(1))
    if (!hash.startsWith('api-')) return
    const target = root.querySelector(`#${CSS.escape(hash)}`)
    if (!target) {
      input.value = hash.slice(4)
      apply()
      return
    }
    if (!target.hasAttribute('data-api-entry')) return
    pinned = target
    input.value = ''
    apply()
    target.closest('[data-api-group]').open = true
    target.scrollIntoView({ block: 'start' })
  }

  input.addEventListener('input', apply)
  window.addEventListener('hashchange', openFromHash)
  cleanup.push(() => window.removeEventListener('hashchange', openFromHash))
  apply()
  openFromHash()
  root.dataset.widgetState = 'ready'
}
