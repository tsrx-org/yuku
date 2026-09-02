const generatedSources = new WeakMap()
const isNode = (value) => value && typeof value === 'object' && typeof value.type === 'string'
const span = (node) => ({ start: node?.start ?? 0, end: node?.end ?? 0 })
const identifier = (name, node) => ({
  type: 'Identifier',
  name,
  decorators: [],
  optional: false,
  typeAnnotation: null,
  ...span(node),
})
const container = (expression, node) => ({ type: 'JSXExpressionContainer', expression, ...span(node) })

function jsxBranch(block, visit) {
  const body = block.body.map(visit).filter(Boolean)
  if (body.length === 1) return body[0]
  return {
    type: 'JSXFragment',
    openingFragment: { type: 'JSXOpeningFragment', ...span(block) },
    children: body,
    closingFragment: { type: 'JSXClosingFragment', ...span(block) },
    ...span(block),
  }
}

function addKey(element, key, visit) {
  if (element.type !== 'JSXElement') return element
  const attribute = {
    type: 'JSXAttribute',
    name: { type: 'JSXIdentifier', name: 'key', ...span(key) },
    value: container(visit(key), key),
    ...span(key),
  }
  return {
    ...element,
    openingElement: {
      ...element.openingElement,
      attributes: [...element.openingElement.attributes, attribute],
    },
  }
}

function rewrite(program) {
  const stats = { constructs: 0, styles: 0 }
  const visit = (node) => {
    if (!isNode(node)) return node
    if (node.type === 'JSXStyleElement') {
      stats.styles++
      return null
    }
    if (node.type === 'JSXCodeBlock') {
      stats.constructs++
      const render = visit(node.render)
      return {
        type: 'BlockStatement',
        body: [
          ...node.body.map(visit).filter(Boolean),
          {
            type: 'ReturnStatement',
            argument: { type: 'ParenthesizedExpression', expression: render, ...span(render) },
            ...span(render),
          },
        ],
        ...span(node),
      }
    }
    if (node.type === 'JSXIfExpression') {
      stats.constructs++
      const alternate = node.alternate?.type === 'JSXIfExpression'
        ? visit(node.alternate).expression
        : node.alternate
          ? jsxBranch(node.alternate, visit)
          : { type: 'Literal', value: null, raw: 'null', ...span(node) }
      return container({
        type: 'ConditionalExpression',
        test: visit(node.test),
        consequent: jsxBranch(node.consequent, visit),
        alternate,
        ...span(node),
      }, node)
    }
    if (node.type === 'JSXForExpression') {
      stats.constructs++
      const statement = node.statement
      const declaration = statement.left?.declarations?.[0]
      if (!declaration) throw new Error('Only declarative @for loops can lower to map()')
      let body = jsxBranch(statement.body, visit)
      if (statement.key) body = addKey(body, statement.key, visit)
      const params = [visit(declaration.id)]
      if (statement.index) params.push(visit(statement.index))
      const arrow = {
        type: 'ArrowFunctionExpression',
        expression: true,
        generator: false,
        async: false,
        params,
        body,
        returnType: null,
        typeParameters: null,
        ...span(node),
      }
      return container({
        type: 'CallExpression',
        callee: {
          type: 'MemberExpression',
          object: visit(statement.right),
          property: identifier('map', statement.right),
          computed: false,
          optional: false,
          ...span(statement.right),
        },
        arguments: [arrow],
        optional: false,
        typeArguments: null,
        ...span(node),
      }, node)
    }
    const next = { ...node }
    for (const [key, value] of Object.entries(next)) {
      if (key === 'comments') continue
      if (Array.isArray(value)) next[key] = value.map(visit).filter((item) => item !== null)
      else if (isNode(value)) next[key] = visit(value)
    }
    return next
  }
  return { program: visit(program), ...stats }
}

function sourceLowerer(program, source) {
  const special = (node) => ['JSXCodeBlock', 'JSXIfExpression', 'JSXForExpression', 'JSXStyleElement'].includes(node.type)
  const nearest = (node) => {
    const found = []
    const seen = new Set()
    const search = (value) => {
      if (!isNode(value) || seen.has(value)) return
      seen.add(value)
      if (value !== node && special(value)) {
        found.push(value)
        return
      }
      for (const [key, child] of Object.entries(value)) {
        if (key === 'comments') continue
        if (Array.isArray(child)) child.forEach(search)
        else search(child)
      }
    }
    search(node)
    return found.sort((a, b) => a.start - b.start)
  }
  const splice = (node, edits) => {
    let output = ''
    let offset = node.start
    for (const edit of edits.sort((a, b) => a.start - b.start)) {
      if (edit.start < offset) continue
      output += source.slice(offset, edit.start) + edit.text
      offset = edit.end
    }
    return output + source.slice(offset, node.end)
  }
  const branch = (block) => {
    const body = block.body.filter((node) => node.type !== 'JSXStyleElement')
    if (body.length === 1) return lower(body[0])
    return `<>${body.map(lower).join('')}</>`
  }
  const ordinary = (node, key = null) => {
    const edits = nearest(node).map((child) => ({ start: child.start, end: child.end, text: lower(child) }))
    if (key && node.type === 'JSXElement') {
      const at = node.openingElement.end - (node.openingElement.selfClosing ? 2 : 1)
      edits.push({ start: at, end: at, text: ` key={${ordinary(key)}}` })
    }
    return splice(node, edits)
  }
  const lower = (node) => {
    if (node.type === 'JSXStyleElement') return ''
    if (node.type === 'JSXCodeBlock') {
      const before = source.slice(node.start + 2, node.render.start)
      return `{${before}return (${ordinary(node.render)});${source.slice(node.render.end, node.end)}`
    }
    if (node.type === 'JSXIfExpression') {
      const alternate = node.alternate?.type === 'JSXIfExpression'
        ? lower(node.alternate).slice(1, -1)
        : node.alternate ? branch(node.alternate) : 'null'
      return `{${ordinary(node.test)} ? ${branch(node.consequent)} : ${alternate}}`
    }
    if (node.type === 'JSXForExpression') {
      const statement = node.statement
      const declaration = statement.left?.declarations?.[0]
      if (!declaration) throw new Error('Only declarative @for loops can lower to map()')
      const params = [ordinary(declaration.id), statement.index ? ordinary(statement.index) : null].filter(Boolean)
      const body = statement.body.body.filter((child) => child.type !== 'JSXStyleElement')
      const rendered = body.length === 1
        ? ordinary(body[0], statement.key)
        : `<>${body.map((child) => ordinary(child)).join('')}</>`
      return `{${ordinary(statement.right)}.map((${params.join(', ')}) => ${rendered})}`
    }
    return ordinary(node)
  }
  return ordinary(program)
}

export function lowerProgram(program, source) {
  const lowered = rewrite(program)
  generatedSources.set(lowered.program, sourceLowerer(program, source))
  return lowered
}

export function generatedSource(program) {
  const source = generatedSources.get(program)
  if (source === undefined) throw new Error('Program was not lowered from source')
  return source
}
