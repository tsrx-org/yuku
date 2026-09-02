// Browser host for the yuku-tsrx dialect compiled to WebAssembly.
//
// The module, the AST decoder and the analyzer decoder are all built from the
// same tree by `pnpm run docs:wasm` + `docs/build.mjs`, so the wire format
// cannot drift. This file is the browser twin of tools/wasm-smoke.mjs: same
// flag packing, same length-prefixed results, same decoders. Nothing here ever
// invents a result; a failed call throws and the caller says so on the page.

const wasmUrl = new URL('./wasm/yuku-tsrx.wasm', import.meta.url)
const decodeUrl = new URL('./wasm/decode.js', import.meta.url)
const decodeAnalyzerUrl = new URL('./wasm/decode-analyzer.js', import.meta.url)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const SOURCE_TYPES = ['script', 'module', 'commonjs']
const LANGS = ['js', 'ts', 'jsx', 'tsx', 'dts']
const QUOTES = ['preserve', 'double', 'single']
const COMMENT_MODES = ['none', 'all', 'some', 'line', 'block']

// bits 0-1 source type, 2-4 lang, 5 preserve parens, 6 semantic early errors,
// 7 attach comments, 8 loose. Mirrors src/ffi/wasm.zig.
export function packFlags(options = {}) {
  const {
    sourceType = 'module',
    lang = 'tsx',
    preserveParens = true,
    semanticErrors = false,
    attachComments = false,
    loose = false,
  } = options
  const sourceTypeIndex = SOURCE_TYPES.indexOf(sourceType)
  const langIndex = LANGS.indexOf(lang)
  if (sourceTypeIndex < 0) throw new Error(`unknown sourceType ${sourceType}`)
  if (langIndex < 0) throw new Error(`unknown lang ${lang}`)
  let flags = sourceTypeIndex
  flags |= langIndex << 2
  if (preserveParens) flags |= 1 << 5
  if (semanticErrors) flags |= 1 << 6
  if (attachComments) flags |= 1 << 7
  if (loose) flags |= 1 << 8
  return flags >>> 0
}

// Same text as npm/yuku-tsrx/index.js, so both hosts refuse the same way.
const QUOTES_SHORTEST_UNSUPPORTED =
  'yuku-tsrx generate: quotes "shortest" is not supported here; the codegen offers "preserve", "double" and "single", and minify picks the shortest quote itself'
const SOURCE_MAPS_UNSUPPORTED =
  'yuku-tsrx generate: sourceMaps is not supported here; the wasm build carries no source maps'

// bit 0 strip, 1 minify, 2 compact, 3-4 quotes, 5-7 comments, 8-15 indent.
export function packGenerateOptions(options = {}) {
  const {
    strip = false,
    minify = false,
    format = 'pretty',
    comments = 'some',
    indent = 2,
    sourceMaps,
  } = options
  let { quotes = 'preserve' } = options
  if (sourceMaps) throw new TypeError(SOURCE_MAPS_UNSUPPORTED)
  if (quotes === 'shortest') {
    if (!minify) throw new TypeError(QUOTES_SHORTEST_UNSUPPORTED)
    quotes = 'preserve'
  }
  const quoteIndex = QUOTES.indexOf(quotes)
  const commentIndex = COMMENT_MODES.indexOf(comments)
  if (quoteIndex < 0) throw new Error(`unknown quotes ${quotes}`)
  if (commentIndex < 0) throw new Error(`unknown comments ${comments}`)
  let opts = 0
  if (strip) opts |= 1 << 0
  if (minify) opts |= 1 << 1
  if (format === 'compact') opts |= 1 << 2
  opts |= quoteIndex << 3
  opts |= commentIndex << 5
  opts |= (indent & 0xff) << 8
  return opts >>> 0
}

export const GENERATE_MODES = ['print', 'strip', 'minify']

let engine = null
let bootPromise = null

async function boot() {
  const response = await fetch(wasmUrl)
  if (!response.ok) {
    throw new Error(`yuku-tsrx wasm: HTTP ${response.status} for ${wasmUrl.pathname}`)
  }
  const contentType = response.headers.get('content-type') ?? ''
  let instance
  // instantiateStreaming refuses anything that is not application/wasm, which
  // is exactly the case a static host can get wrong, so fall back to the bytes.
  if (typeof WebAssembly.instantiateStreaming === 'function' && contentType.includes('application/wasm')) {
    ;({ instance } = await WebAssembly.instantiateStreaming(response, {}))
  } else {
    ;({ instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {}))
  }
  for (const name of ['memory', 'alloc', 'free', 'parse', 'analyze', 'generate']) {
    if (!(name in instance.exports)) throw new Error(`yuku-tsrx wasm: missing export ${name}`)
  }
  const [{ decode }, analyzer] = await Promise.all([
    import(decodeUrl.href),
    import(decodeAnalyzerUrl.href),
  ])
  engine = {
    exports: instance.exports,
    decode,
    decodeAnalyzer: analyzer.decode,
    SymbolFlags: analyzer.SymbolFlags,
  }
  return engine
}

// Lazy singleton: nothing is fetched until the first caller asks for it, and a
// failure is remembered as a rejection rather than retried on every keystroke.
export function ready() {
  bootPromise ??= boot()
  return bootPromise
}

export function isReady() {
  return engine !== null
}

export function symbolFlags() {
  return engine?.SymbolFlags ?? null
}

// Every call may grow the memory, so each typed-array view is built fresh from
// the current buffer rather than cached across calls.
function writeSource(source) {
  const bytes = encoder.encode(source)
  const len = Math.max(bytes.length, 1)
  const ptr = engine.exports.alloc(len)
  if (ptr === 0) throw new Error('yuku-tsrx wasm: alloc returned 0')
  new Uint8Array(engine.exports.memory.buffer, ptr, bytes.length).set(bytes)
  return { ptr, len, byteLength: bytes.length }
}

function takePrefixed(ptr) {
  const header = new DataView(engine.exports.memory.buffer)
  const len = header.getUint32(ptr, true)
  const copy = engine.exports.memory.buffer.slice(ptr + 4, ptr + 4 + len)
  engine.exports.free(ptr, 4 + len)
  return copy
}

function call(name, source, flags, opts) {
  const input = writeSource(source)
  try {
    const ptr =
      opts === undefined
        ? engine.exports[name](input.ptr, input.byteLength, flags)
        : engine.exports[name](input.ptr, input.byteLength, flags, opts)
    if (ptr === 0) throw new Error(`yuku-tsrx wasm: ${name} failed`)
    return takePrefixed(ptr)
  } finally {
    engine.exports.free(input.ptr, input.len)
  }
}

// Header u32[0] is Header.node_count (src/dialect/transfer.zig).
const nodeCountOf = (buffer) => new Uint32Array(buffer, 0, 1)[0]

export async function parse(source, options = {}) {
  await ready()
  const started = performance.now()
  const buffer = call('parse', source, packFlags(options))
  const view = engine.decode(buffer, source)
  const result = {
    program: view.program,
    comments: view.comments,
    diagnostics: view.diagnostics,
    nodeCount: nodeCountOf(buffer),
    ms: performance.now() - started,
  }
  return result
}

export async function analyze(source, options = {}) {
  await ready()
  const started = performance.now()
  const buffer = call('analyze', source, packFlags(options))
  const view = engine.decodeAnalyzer(buffer, source)
  view.nodeCount = nodeCountOf(buffer)
  view.ms = performance.now() - started
  return view
}

export async function generate(source, options = {}, generateOptions = {}) {
  await ready()
  const started = performance.now()
  const payload = call(
    'generate',
    source,
    packFlags(options),
    packGenerateOptions(generateOptions),
  )
  const view = new DataView(payload)
  let offset = 0
  const codeLength = view.getUint32(offset, true)
  offset += 4
  const code = decoder.decode(new Uint8Array(payload, offset, codeLength))
  offset += codeLength
  const errorCount = view.getUint32(offset, true)
  offset += 4
  const errors = []
  for (let i = 0; i < errorCount; i++) {
    const start = view.getUint32(offset, true)
    const end = view.getUint32(offset + 4, true)
    const messageLength = view.getUint32(offset + 8, true)
    offset += 12
    errors.push({
      start,
      end,
      message: decoder.decode(new Uint8Array(payload, offset, messageLength)),
    })
    offset += messageLength
  }
  if (offset !== payload.byteLength) {
    throw new Error(`yuku-tsrx wasm: generate payload is ${payload.byteLength} bytes but decoded ${offset}`)
  }
  return { code, errors, ms: performance.now() - started }
}
