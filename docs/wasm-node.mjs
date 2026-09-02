// The dialect's WebAssembly build, instantiated in Node for the docs build.
// Same flag packing and length-prefixed results as docs/assets/yuku-wasm.js
// and tools/wasm-smoke.mjs, decoded with the generated decoders in npm/.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SOURCE_TYPES = ['script', 'module', 'commonjs']
const LANGS = ['js', 'ts', 'jsx', 'tsx', 'dts']
const QUOTES = ['preserve', 'double', 'single']
const COMMENT_MODES = ['none', 'all', 'some', 'line', 'block']

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function packFlags({
  sourceType = 'module',
  lang = 'tsx',
  preserveParens = true,
  semanticErrors = true,
  attachComments = false,
  loose = false,
} = {}) {
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

export function packGenerateOptions({
  strip = false,
  minify = false,
  format = 'pretty',
  quotes = 'preserve',
  comments = 'some',
  indent = 2,
} = {}) {
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

export async function createNodeEngine({ wasmPath, decodersDir }) {
  const relative = path.basename(wasmPath)
  let bytes
  try {
    bytes = await readFile(wasmPath)
  } catch {
    throw new Error(`missing ${wasmPath}: run \`pnpm run docs:wasm\` first`)
  }
  let instance
  try {
    instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {})
  } catch (error) {
    throw new Error(`${relative} did not instantiate in Node: ${error.message}`)
  }
  const exports = instance.exports
  for (const name of ['memory', 'alloc', 'free', 'parse', 'analyze', 'generate']) {
    if (!(name in exports)) throw new Error(`${relative}: missing export \`${name}\``)
  }
  const [{ decode }, { decode: decodeAnalyzer }] = await Promise.all([
    import(pathToFileURL(path.join(decodersDir, 'decode.js')).href),
    import(pathToFileURL(path.join(decodersDir, 'decode-analyzer.js')).href),
  ])

  // Every call may grow the memory, so each view is built from the current buffer.
  function call(name, source, flags, opts) {
    const input = encoder.encode(source)
    const len = Math.max(input.length, 1)
    const ptr = exports.alloc(len)
    if (ptr === 0) throw new Error('yuku-tsrx wasm: alloc returned 0')
    new Uint8Array(exports.memory.buffer, ptr, input.length).set(input)
    try {
      const result =
        opts === undefined
          ? exports[name](ptr, input.length, flags)
          : exports[name](ptr, input.length, flags, opts)
      if (result === 0) throw new Error(`yuku-tsrx wasm: ${name} returned a null pointer`)
      const length = new DataView(exports.memory.buffer).getUint32(result, true)
      const payload = exports.memory.buffer.slice(result + 4, result + 4 + length)
      exports.free(result, 4 + length)
      return payload
    } finally {
      exports.free(ptr, len)
    }
  }

  return {
    bytes,
    parse(source, options = {}) {
      const buffer = call('parse', source, packFlags(options))
      const view = decode(buffer, source)
      return {
        program: view.program,
        comments: view.comments,
        diagnostics: view.diagnostics,
        nodeCount: new Uint32Array(buffer, 0, 1)[0],
      }
    },
    analyze(source, options = {}) {
      return decodeAnalyzer(call('analyze', source, packFlags(options)), source)
    },
    generate(source, options = {}, generateOptions = {}) {
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
        throw new Error(`generate payload is ${payload.byteLength} bytes but decoded ${offset}`)
      }
      return { code, errors }
    },
  }
}
