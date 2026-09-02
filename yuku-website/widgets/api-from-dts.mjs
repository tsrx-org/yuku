// `<!-- widget:api-from-dts -->`: every export of npm/yuku/index.d.ts,
// walked with the TypeScript compiler at build. The functions it declares must
// be exactly the ones index.js exports, every option must have a default listed
// here, and every Try snippet must parse, or the build stops.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import ts from 'typescript'

// Defaults are the addon's (src/ffi/root.zig, src/dialect/codegen.zig) and the
// wrapper's (npm/yuku/index.js), as receipted in 02-facts.md section 4.
const DEFAULTS = {
  ParseOptions: {
    lang: '"js"',
    sourceType: '"module"',
    preserveParens: 'true',
    semanticErrors: 'false',
    attachComments: 'false',
    loose: 'false',
  },
  ParseModuleOptions: {
    lang: 'from the filename: .tsrx and .tsx give "tsx", .jsx "jsx", .d.ts "dts", .ts "ts", anything else "js"',
    preserveParens: 'true',
    semanticErrors: 'true',
    attachComments: 'true when comments is passed',
    loose: 'false',
    collect: 'false: the first error is thrown as a SyntaxError',
    errors: 'none; filled only with collect or loose',
    comments: 'none',
  },
  GenerateOptions: {
    strip: 'false',
    minify: 'false',
    format: '"pretty"',
    indent: '2',
    quotes: '"preserve"; "shortest" only inside minify: { syntax: true }',
    comments: '"some"',
    sourceMaps: 'none: map is null',
  },
  NormalizeProgramOptions: {
    onNode: 'none',
  },
}

const INHERITED = { ParseModuleOptions: 'ParseOptions' }

// One TSRX snippet per function; the playground parses it, so a comment says
// which tab shows the function's territory.
const TRY = {
  parse: `// parse(source, { lang: "tsx" }) returns { program, comments, diagnostics }
const panel = @if (open) {
  <Panel title="open" />
} @else {
  <Panel title="closed" />
};`,
  parseModule: `// parseModule(source, "view.tsrx") infers lang "tsx" from the name
// and throws a SyntaxError on the first error unless { collect: true }
const rows = @for (const item of items; key item.id) {
  <li>{item.label}</li>
} @empty {
  <li>nothing yet</li>
};`,
  analyze: `// analyze(source, "cart.tsrx"): open the Semantic tab for scopes, symbols, references
export function Cart({ items }: { items: string[] }) @{
  const total = items.length;
  @for (const item of items) {
    <li>{item}</li>
  }
}`,
  generate: `// generate(program, { strip: true }): open the Generated code tab
const label: string = 'x' + "y";
type Props = { open: boolean };
const view = @if (open) { <b>{label}</b> };`,
  parseWire: `// parseWire(source) returns the ArrayBuffer decode() turns into this tree
const view = @{ <span>{count}</span> };`,
  decode: `// decode(buffer, source) builds this tree from a parseWire() buffer
const view = @{ <span>{count}</span> };`,
  decodeAnalyzer: `// decodeAnalyzer(buffer, source) is decode() plus the semantic tables
export const view = @{ <span>{count}</span> };`,
  encode: `// encode(program) turns this tree back into a buffer generate() can read
const view = @{ <span>{count}</span> };`,
  walk: `// walk(program, { JSXForExpression(node) { ... } }) visits the @for below
const rows = @for (const item of items) {
  <li>{item}</li>
};`,
  normalizeProgram: `// normalizeProgram(program) aliases node.left/right/body onto the JSXForExpression
const rows = @for (const item of items; index i) {
  <li>{i}: {item}</li>
};`,
  duplicateBindings: `// duplicateBindings(program, source) reports the second "a"; the Diagnostics tab shows the same warning
let a = 1;
let a = 2;
var b;
var b;`,
  duplicateBindingDiagnostics: `// duplicateBindingDiagnostics(program, source) renders each repeat as a Diagnostic with two labels
const view = @{ <b /> };
const view = @{ <i /> };`,
  sourcePosition: `// sourcePosition(source, offset) turns a node's start into { line, column }
const first = 1;
const view = @if (first) { <b /> };`,
  sourceLocation: `// sourceLocation(source, start, end) gives an ESTree loc for any span in the AST tab
const view = @switch (kind) {
  @case "a": { <A /> }
  @default: { <B /> }
};`,
  authoredDiagnosticSpan: {
    expectsError: true,
    code: `// authoredDiagnosticSpan(diagnostic, source) widens the span back over "</"
// (Diagnostics tab: the closing tag below does not match, on purpose)
const view = @{ <a><b></a> };`,
  },
  isEventAttribute: `// isEventAttribute("onClick") is true; isEventAttribute("once") is false
const view = @{ <button onClick={go} onClickCapture={trace}>go</button> };`,
  normalizeEventName: `// normalizeEventName("onGotPointerCapture") is "gotpointercapture"
const view = @{ <div onGotPointerCapture={hold} onKeyDown={key} /> };`,
}

const GROUPS = [
  { id: 'functions', title: 'Functions', test: (entry) => entry.kind === 'function' },
  { id: 'options', title: 'Options', test: (entry) => entry.name.endsWith('Options') },
  { id: 'results', title: 'Results', test: (entry) => entry.name.endsWith('Result') },
  {
    id: 'semantic',
    title: 'Semantic view',
    test: (entry) =>
      /^(Semantic|Analyzer)/.test(entry.name) ||
      /^(ScopeKind|ReferenceSpace|ImportKind|ImportPhase|ExportKind|NodeIndex|ScopeId|SymbolId|ReferenceId)$/.test(
        entry.name,
      ),
  },
  {
    id: 'diagnostics',
    title: 'Diagnostics, positions and source kinds',
    test: (entry) =>
      /^(Diagnostic|DiagnosticLabel|Comment|SourcePosition|SourceLocation|DuplicateBinding|SourceLang|SourceType)$/.test(
        entry.name,
      ),
  },
  { id: 'walk', title: 'Walk', test: (entry) => /^(WalkVisitor|Visitors)$/.test(entry.name) },
  { id: 'nodes', title: 'Node types', test: (entry) => entry.nodeShaped },
  { id: 'other', title: 'Other types', test: () => true },
]

const isExported = (node) =>
  node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false

const docOf = (node) =>
  ts
    .getJSDocCommentsAndTags(node)
    .filter((doc) => ts.isJSDoc(doc))
    .map((doc) => ts.getTextOfJSDocComment(doc.comment) ?? '')
    .filter(Boolean)
    .join('\n\n')

function nodeShaped(node, source) {
  if (ts.isInterfaceDeclaration(node)) {
    if (node.members.some((member) => member.name?.getText(source) === 'type')) return true
    return (
      node.heritageClauses?.some((clause) =>
        clause.types.some((type) => /^(BaseNode|Statement|Expression|Pattern)$/.test(type.expression.getText(source))),
      ) ?? false
    )
  }
  return /\bBaseNode\b|\bTSRXExpression\b/.test(node.type.getText(source))
}

// `parse(source, options?): ParseResult`: the one-line form a reader scans
// before deciding to open the entry.
function briefOf(statement, source) {
  if (ts.isFunctionDeclaration(statement)) {
    const params = statement.parameters
      .map((parameter) => `${parameter.name.getText(source)}${parameter.questionToken ? '?' : ''}`)
      .join(', ')
    return `${statement.name.text}(${params})${statement.type ? `: ${statement.type.getText(source)}` : ''}`
  }
  if (ts.isInterfaceDeclaration(statement)) {
    const heritage = statement.heritageClauses
      ?.flatMap((clause) => clause.types.map((type) => type.getText(source)))
      .join(', ')
    return heritage ? `extends ${heritage}` : `${statement.members.length} fields`
  }
  const type = statement.type.getText(source).replace(/\s+/g, ' ')
  return `= ${type.length > 72 ? `${type.slice(0, 71)}…` : type}`
}

const firstSentence = (doc) => {
  const paragraph = doc.split(/\n\n+/)[0].replace(/\s+/g, ' ').trim()
  const stop = /[.!?](\s|$)/.exec(paragraph)
  return stop ? paragraph.slice(0, stop.index + 1) : paragraph
}

function declarations(text) {
  const source = ts.createSourceFile('index.d.ts', text, ts.ScriptTarget.Latest, true)
  const entries = new Map()
  for (const statement of source.statements) {
    if (!isExported(statement)) continue
    const isFunction = ts.isFunctionDeclaration(statement)
    if (!isFunction && !ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) continue
    const name = statement.name.text
    const signature = text.slice(statement.getStart(source), statement.end)
    const doc = docOf(statement)
    const entry = entries.get(name) ?? {
      name,
      kind: isFunction ? 'function' : ts.isInterfaceDeclaration(statement) ? 'interface' : 'type',
      signatures: [],
      members: [],
      nodeShaped: isFunction ? false : nodeShaped(statement, source),
      brief: briefOf(statement, source),
      summary: isFunction ? '' : firstSentence(doc),
    }
    entry.signatures.push({ text: signature, doc })
    if (ts.isInterfaceDeclaration(statement)) {
      for (const member of statement.members) {
        if (!ts.isPropertySignature(member) && !ts.isMethodSignature(member)) continue
        entry.members.push({
          name: member.name.getText(source),
          optional: Boolean(member.questionToken),
          type: ts.isPropertySignature(member)
            ? (member.type?.getText(source) ?? '')
            : text.slice(member.getStart(source), member.end).replace(/;$/, ''),
          doc: docOf(member),
        })
      }
    }
    entries.set(name, entry)
  }
  return [...entries.values()]
}

function runtimeExports(text) {
  const source = ts.createSourceFile('index.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  const names = new Set()
  for (const statement of source.statements) {
    if (ts.isFunctionDeclaration(statement) && isExported(statement)) names.add(statement.name.text)
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) names.add(element.name.text)
    }
  }
  return names
}

const snippetOf = (name) => (typeof TRY[name] === "string" ? TRY[name] : TRY[name].code)

const toBase64Url = (text) => Buffer.from(text, 'utf8').toString('base64url')

// Backticks in a doc comment become code; everything else is escaped text.
const inlineDoc = (text, escapeHtml) => escapeHtml(text).replaceAll(/`([^`]+)`/g, '<code>$1</code>')

const LIST_ITEM = /^(\d+\.|[-*])\s+/

// A block whose first line starts with `1.` or `-` is a list; an indented line
// continues the item above it.
function docHtml(doc, escapeHtml) {
  return doc
    .split(/\n\n+/)
    .map((block) => {
      const lines = block.split('\n')
      const head = LIST_ITEM.exec(lines[0])
      if (!head) return `<p class="api-doc">${inlineDoc(block.replace(/\s*\n\s*/g, ' '), escapeHtml)}</p>`
      const items = []
      for (const line of lines) {
        const item = LIST_ITEM.exec(line)
        if (item) items.push(line.slice(item[0].length))
        else items[items.length - 1] += ` ${line.trim()}`
      }
      const tag = /^\d/.test(head[1]) ? 'ol' : 'ul'
      return `<${tag} class="api-doc">${items.map((item) => `<li>${inlineDoc(item, escapeHtml)}</li>`).join('')}</${tag}>`
    })
    .join('')
}

function membersTable(entry, escapeHtml) {
  const defaults = DEFAULTS[entry.name]
  const rows = entry.members.map((member) => {
    let fallback = ''
    if (defaults) {
      if (!(member.name in defaults)) {
        throw new Error(`api-from-dts: ${entry.name}.${member.name} has no default listed; add it to DEFAULTS`)
      }
      fallback = defaults[member.name]
    }
    return `<tr><td><code>${escapeHtml(member.name)}${member.optional ? '?' : ''}</code></td><td><code>${escapeHtml(member.type)}</code></td>${
      defaults ? `<td>${escapeHtml(fallback)}</td>` : ''
    }<td>${member.doc ? escapeHtml(member.doc).replaceAll(/`([^`]+)`/g, '<code>$1</code>') : ''}</td></tr>`
  })
  if (defaults) {
    const own = new Set(entry.members.map((member) => member.name))
    for (const [name, fallback] of Object.entries(defaults)) {
      if (own.has(name)) continue
      rows.push(
        `<tr><td><code>${escapeHtml(name)}?</code></td><td><span class="api-inherited">from <code>${escapeHtml(INHERITED[entry.name] ?? '?')}</code></span></td><td>${escapeHtml(fallback)}</td><td></td></tr>`,
      )
    }
  }
  if (rows.length === 0) return ''
  return `<div class="table-wrap api-members"><table>
<thead><tr><th>Field</th><th>Type</th>${defaults ? '<th>Default</th>' : ''}<th></th></tr></thead>
<tbody>${rows.join('\n')}</tbody></table></div>`
}

export default async function render({ ctx }) {
  const packageDir = path.join(ctx.repoRoot, 'npm', 'yuku')
  const dts = await readFile(path.join(packageDir, 'index.d.ts'), 'utf8')
  const entries = declarations(dts)
  const declared = new Set(entries.filter((entry) => entry.kind === 'function').map((entry) => entry.name))
  const exported = runtimeExports(await readFile(path.join(packageDir, 'index.js'), 'utf8'))
  const onlyDeclared = [...declared].filter((name) => !exported.has(name))
  const onlyExported = [...exported].filter((name) => !declared.has(name))
  if (onlyDeclared.length > 0 || onlyExported.length > 0) {
    throw new Error(
      `api-from-dts: index.d.ts and index.js disagree; declared only: ${onlyDeclared.join(', ') || 'none'}; exported only: ${onlyExported.join(', ') || 'none'}`,
    )
  }
  // A snippet meant to show a diagnostic must produce one; every other snippet must parse clean.
  for (const name of declared) {
    if (!TRY[name]) throw new Error(`api-from-dts: no Try snippet for ${name}`)
    const result = await ctx.parse(snippetOf(name), { lang: "tsx", sourceType: "module", semanticErrors: false })
    const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")
    if (TRY[name].expectsError && errors.length === 0) {
      throw new Error(`api-from-dts: the Try snippet for ${name} was meant to show an error and parsed clean`)
    }
    if (!TRY[name].expectsError && errors.length > 0) {
      throw new Error(`api-from-dts: the Try snippet for ${name} does not parse: ${errors[0].message}`)
    }
  }
  const playground = ctx.withBase('/playground')
  const grouped = GROUPS.map((group) => ({ ...group, entries: [] }))
  for (const entry of entries) grouped.find((group) => group.test(entry)).entries.push(entry)
  const sections = []
  for (const group of grouped) {
    if (group.entries.length === 0) continue
    const items = []
    for (const entry of group.entries) {
      const signatures = []
      for (const signature of entry.signatures) {
        signatures.push(
          `${signature.doc ? docHtml(signature.doc, ctx.escapeHtml) : ''}<div class="code-block api-sig" data-lang="ts">${await ctx.highlight(signature.text, 'ts')}</div>`,
        )
      }
      const name = ctx.escapeHtml(entry.name)
      const tryLink = TRY[entry.name]
        ? `<a href="${playground}#code=${toBase64Url(snippetOf(entry.name))}">Try <code>${name}</code> in the playground</a>`
        : ''
      const brief = entry.summary
        ? `<span class="api-brief">${inlineDoc(entry.summary, ctx.escapeHtml)}</span>`
        : `<code class="api-brief api-brief-sig">${ctx.escapeHtml(entry.brief)}</code>`
      items.push(`<details class="api-entry" data-api-entry data-api-kind="${entry.kind}" data-api-name="${name}" id="api-${name}">
      <summary class="api-head"><code class="api-name">${name}</code> <span class="api-kind">${entry.kind}</span> ${brief}</summary>
      <div class="api-body">
      ${signatures.join('\n')}
      ${membersTable(entry, ctx.escapeHtml)}
      <p class="api-try">${tryLink} <a class="api-anchor" href="#api-${name}">link to this entry</a></p>
      </div>
    </details>`)
    }
    sections.push(`<details class="api-group" data-api-group open>
    <summary><h3 class="api-group-title" id="api-group-${group.id}">${group.title} <span class="matrix-count" data-api-group-count>${group.entries.length}</span></h3></summary>
    ${items.join('\n    ')}
  </details>`)
  }
  return `<div class="ex-controls ex-toolbar api-toolbar">
    <label class="api-filter-label">Filter exports <input type="search" data-api-filter placeholder="Filter exports" aria-label="Filter the exports by name or any word in a signature" autocomplete="off"></label>
    <span class="api-count" data-api-count>${entries.length} exports</span>
  </div>
  <div class="api-groups" data-api-groups data-api-functions="${declared.size}">
  ${sections.join('\n  ')}
  </div>
  <figcaption class="ex-status" data-widget-status aria-live="polite">read from npm/yuku/index.d.ts when this page was built; ${declared.size} functions checked against index.js</figcaption>`
}

export async function markdown({ page }) {
  void page
  return 'On the site this section lists every export of `npm/yuku/index.d.ts`, read with the TypeScript compiler when the page builds, one line per export that opens on click: each function with its signature and a Try link into the playground, each options object with the default of every field, and every result, semantic-table and node type.'
}
