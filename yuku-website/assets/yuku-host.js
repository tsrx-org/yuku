// Loads the published @tsrx/yuku in this tab and times each call.
let modulePromise = null

export function ready() {
  modulePromise ??= import(
    new URL(`./yuku-tsrx.js${document.documentElement.dataset.assetVersion ?? ''}`, import.meta.url)
  )
  return modulePromise
}

function countNodes(root) {
  let count = 0
  const stack = [root]
  while (stack.length > 0) {
    const value = stack.pop()
    if (value === null || typeof value !== 'object') continue
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item)
      continue
    }
    if (typeof value.type !== 'string') continue
    count += 1
    for (const key in value) {
      if (key !== 'comments') stack.push(value[key])
    }
  }
  return count
}

export async function parse(source, options) {
  const yuku = await ready()
  const started = performance.now()
  const result = yuku.parse(source, options)
  const program = result.program
  const ms = performance.now() - started
  return { program, comments: result.comments, diagnostics: result.diagnostics, nodeCount: countNodes(program), ms }
}

export async function analyze(source, options) {
  const yuku = await ready()
  return yuku.analyze(source, options)
}

export async function generate(program, options) {
  const yuku = await ready()
  return yuku.generate(program, options)
}

export async function bindingFlags() {
  return (await ready()).BindingFlags
}
