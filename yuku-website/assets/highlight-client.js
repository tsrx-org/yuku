// Highlights code in the browser with the same shiki grammars the build uses.
let highlighterPromise = null

const firstLoad = () =>
  document.documentElement.dataset.afterFirstLoad === 'true'
    ? Promise.resolve()
    : new Promise((resolve) => window.addEventListener('yuku-after-first-load', resolve, { once: true }))

async function highlighter() {
  await firstLoad()
  highlighterPromise ??= import(
    new URL(`./demo-highlighter.js${document.documentElement.dataset.assetVersion ?? ''}`, import.meta.url)
  ).then((module) => module.createDemoHighlighter())
  return highlighterPromise
}

export async function highlightedHtml(source, preClass, lang = 'tsrx') {
  const template = document.createElement('template')
  template.innerHTML = (await highlighter()).highlight(source, lang)
  const pre = template.content.firstElementChild
  pre.classList.add(...preClass.split(' ').filter(Boolean))
  return pre.outerHTML
}
