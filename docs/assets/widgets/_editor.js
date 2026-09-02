export function createLayeredEditor({
  host,
  source,
  render,
  onChange,
  ariaLabel,
  rows,
  debounceMs = 120,
  onPointerOffset,
  onClickOffset,
  onFocusOffset,
  afterRender,
}) {
  let value = source
  let timer = null
  let renderTicket = 0
  let pointerFrame = null
  let pointerPosition = null
  let hovered = null
  host.innerHTML = '<div class="ex-editor-layer"></div>'
  const layer = host.querySelector('.ex-editor-layer')
  const textarea = document.createElement('textarea')
  textarea.className = 'ex-editor'
  textarea.spellcheck = false
  textarea.wrap = 'off'
  textarea.setAttribute('aria-label', ariaLabel)
  textarea.value = value
  if (rows) textarea.rows = rows

  const renderMirror = async () => {
    const ticket = ++renderTicket
    const rendered = document.createElement('div')
    rendered.innerHTML = await render(value)
    if (ticket !== renderTicket) return
    const nextMirror = rendered.firstElementChild
    nextMirror.setAttribute('aria-hidden', 'true')
    afterRender?.(nextMirror, value)
    if (nextMirror.querySelector('[data-readout]')) nextMirror.removeAttribute('aria-hidden')
    const mirror = layer.querySelector('.ex-source')
    if (mirror) mirror.replaceWith(nextMirror)
    else layer.prepend(nextMirror)
    nextMirror.scrollLeft = textarea.scrollLeft
    nextMirror.scrollTop = textarea.scrollTop
  }

  const forwardHover = (next, position) => {
    if (next !== hovered) {
      hovered?.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: next, ...position }))
      next?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: hovered, ...position }))
      hovered = next
    }
    if (onPointerOffset && next) {
      const mark = next?.closest('[data-start]')
      onPointerOffset(next, mark ? Number(mark.dataset.start) : textarea.selectionStart)
    }
  }

  const hitTestMirror = ({ clientX, clientY }) => {
    const pointerEvents = textarea.style.pointerEvents
    textarea.style.pointerEvents = 'none'
    const target = document.elementFromPoint(clientX, clientY)
    textarea.style.pointerEvents = pointerEvents
    const mirror = layer.querySelector('.ex-source')
    return mirror?.contains(target) ? target : null
  }

  const flushPointer = () => {
    pointerFrame = null
    if (!pointerPosition) return
    forwardHover(hitTestMirror(pointerPosition), pointerPosition)
  }

  renderMirror()
  layer.append(textarea)
  textarea.addEventListener('scroll', () => {
    const mirror = layer.querySelector('.ex-source')
    mirror.scrollLeft = textarea.scrollLeft
    mirror.scrollTop = textarea.scrollTop
  })
  textarea.addEventListener('pointermove', (event) => {
    pointerPosition = { clientX: event.clientX, clientY: event.clientY }
    if (pointerFrame === null) pointerFrame = requestAnimationFrame(flushPointer)
  })
  textarea.addEventListener('pointerleave', (event) => {
    pointerPosition = null
    if (pointerFrame !== null) cancelAnimationFrame(pointerFrame)
    pointerFrame = null
    forwardHover(null, { clientX: event.clientX, clientY: event.clientY })
  })
  if (onClickOffset) {
    textarea.addEventListener('click', () => onClickOffset(textarea.selectionStart))
  }
  if (onFocusOffset) {
    const reportFocus = () => onFocusOffset(textarea.selectionStart)
    textarea.addEventListener('focus', reportFocus)
    textarea.addEventListener('keyup', reportFocus)
    textarea.addEventListener('select', reportFocus)
  }
  textarea.addEventListener('input', () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      value = textarea.value
      renderMirror()
      onChange(value)
    }, debounceMs)
  })

  return {
    textarea,
    render() {
      return renderMirror()
    },
    setValue(nextValue) {
      value = nextValue
      textarea.value = value
      return renderMirror()
    },
    dispose() {
      clearTimeout(timer)
      if (pointerFrame !== null) cancelAnimationFrame(pointerFrame)
      pointerFrame = null
      pointerPosition = null
      forwardHover(null, {})
    },
  }
}
