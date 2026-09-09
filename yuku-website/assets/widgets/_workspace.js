let nextWorkspaceId = 0

// Keep source and result together: two columns when they fit, tabs otherwise.
export function mountWorkspace(host) {
  const root = host.closest('.code-workspace')
  if (!root || root.dataset.workspaceReady) return () => {}
  const tabs = [...root.querySelectorAll('[data-workspace-tab]')]
  const panels = [...root.querySelectorAll('[data-workspace-panel]')]
  const tablist = root.querySelector('[data-workspace-tabs]')
  if (!tablist || tabs.length !== 2 || panels.length !== 2) return () => {}
  const id = `code-workspace-${++nextWorkspaceId}`
  let selected = 0
  let compact = false

  tabs.forEach((tab, index) => {
    tab.id = `${id}-tab-${index}`
    panels[index].id = `${id}-panel-${index}`
    tab.setAttribute('aria-controls', panels[index].id)
    panels[index].setAttribute('aria-labelledby', tab.id)
  })
  const update = () => {
    compact = root.clientWidth < 520
    tablist.hidden = !compact
    tabs.forEach((tab, index) => {
      tab.setAttribute('aria-selected', String(index === selected))
      tab.tabIndex = index === selected ? 0 : -1
      panels[index].hidden = compact && index !== selected
      panels[index].setAttribute('role', compact ? 'tabpanel' : 'region')
    })
  }
  const select = (index) => {
    selected = index
    update()
    tabs[index].focus()
  }
  const onClick = (event) => {
    const index = tabs.indexOf(event.target.closest('[data-workspace-tab]'))
    if (index !== -1) select(index)
  }
  const onKeyDown = (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    select(event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - selected)
  }
  tablist.addEventListener('click', onClick)
  tablist.addEventListener('keydown', onKeyDown)
  root.dataset.workspaceReady = 'true'
  const observer = new ResizeObserver(update)
  observer.observe(root)
  update()
  return () => {
    observer.disconnect()
    tablist.removeEventListener('click', onClick)
    tablist.removeEventListener('keydown', onKeyDown)
    delete root.dataset.workspaceReady
  }
}
