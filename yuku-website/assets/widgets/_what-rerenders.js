const isNode = (value) => value && typeof value === 'object' && typeof value.type === 'string'

function walk(node, visit, parent = null) {
  if (!isNode(node)) return
  visit(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'comments') continue
    if (Array.isArray(value)) {
      for (const child of value) walk(child, visit, node)
    } else walk(value, visit, node)
  }
}

function referencesIn(semantic, node) {
  const ids = new Set()
  for (let index = 0; index < semantic.reference.count; index++) {
    if (semantic.reference.start(index) < node.start || semantic.reference.end(index) > node.end) continue
    const symbolId = semantic.reference.symbolId(index)
    if (symbolId !== null) ids.add(symbolId)
  }
  return ids
}

function declarationSymbol(semantic, node) {
  for (let id = 0; id < semantic.symbol.count; id++) {
    for (let index = 0; index < semantic.symbol.declCount(id); index++) {
      const declaration = semantic.symbol.declNode(id, index)
      if (declaration.start === node.start && declaration.end === node.end) return id
    }
  }
  return null
}

function expressionLabel(source, expression) {
  return source.slice(expression.start, expression.end)
}

export function rerenderModel(view, source) {
  const { program, semantic } = view
  const selectable = new Set()
  const dependencies = new Map()
  const places = []

  walk(program, (node) => {
    if (node.type === 'FunctionDeclaration' && node.body?.type === 'JSXCodeBlock') {
      for (const parameter of node.params) {
        if (parameter.type !== 'ObjectPattern') continue
        for (const property of parameter.properties) {
          if (property.type !== 'Property' || property.value?.type !== 'Identifier') continue
          const symbolId = declarationSymbol(semantic, property.value)
          if (symbolId !== null) selectable.add(symbolId)
        }
      }
    }
    if (node.type === 'VariableDeclarator' && node.id?.type === 'Identifier' && node.init) {
      const symbolId = declarationSymbol(semantic, node.id)
      if (symbolId !== null) {
        selectable.add(symbolId)
        dependencies.set(symbolId, referencesIn(semantic, node.init))
      }
    }
    if (node.type === 'JSXForExpression') {
      const binding = node.statement?.left?.declarations?.[0]?.id
      if (binding?.type === 'Identifier') {
        const symbolId = declarationSymbol(semantic, binding)
        if (symbolId !== null) dependencies.set(symbolId, referencesIn(semantic, node.statement.right))
      }
      places.push({
        start: node.start,
        end: node.end,
        label: 'the @for',
        symbols: referencesIn(semantic, node.statement.right),
      })
    }
    if (node.type === 'JSXExpressionContainer') {
      places.push({
        start: node.start,
        end: node.end,
        label: expressionLabel(source, node.expression),
        symbols: referencesIn(semantic, node.expression),
      })
    }
  })

  const clickable = []
  for (const symbolId of selectable) {
    const name = semantic.symbol.name(symbolId)
    for (let index = 0; index < semantic.symbol.declCount(symbolId); index++) {
      const node = semantic.symbol.declNode(symbolId, index)
      clickable.push({ start: node.start, end: node.end, symbolId, name })
    }
    for (let index = 0; index < semantic.reference.count; index++) {
      if (semantic.reference.symbolId(index) !== symbolId) continue
      clickable.push({
        start: semantic.reference.start(index),
        end: semantic.reference.end(index),
        symbolId,
        name,
      })
    }
  }

  const dependsOn = (symbolId, selected, seen = new Set()) => {
    if (symbolId === selected) return true
    if (seen.has(symbolId)) return false
    seen.add(symbolId)
    for (const dependency of dependencies.get(symbolId) ?? []) {
      if (dependsOn(dependency, selected, seen)) return true
    }
    return false
  }
  const select = (symbolId) => {
    const hits = places.filter((place) => [...place.symbols].some((id) => dependsOn(id, symbolId)))
    return {
      name: semantic.symbol.name(symbolId),
      symbolId,
      places: hits,
      readout: `${semantic.symbol.name(symbolId)} feeds ${hits.length} ${hits.length === 1 ? 'place' : 'places'}: ${hits.map((place) => place.label).join(', ')}`,
    }
  }
  const byName = new Map([...selectable].map((id) => [semantic.symbol.name(id), id]))
  return { clickable, select, symbol: (name) => byName.get(name) ?? null }
}
