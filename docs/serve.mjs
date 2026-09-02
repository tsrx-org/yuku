// Minimal static file server for the built docs site. Run: node docs/serve.mjs [port]
// Binds 127.0.0.1 explicitly so an already-taken port fails loudly instead of
// silently coexisting on another interface.
//
// It serves docs/dist exactly as the deploy does: extensionless routes resolve
// to their .html files (Vercel cleanUrls), directories resolve to index.html,
// and the redirects the build wrote into dist/vercel.json are honoured.
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import config from './site.config.mjs'

const docsDir = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(docsDir, 'dist')
const requestedPort = Number(process.argv[2] ?? 4519)
if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65_535) {
  throw new Error(`invalid docs port: ${process.argv[2] ?? requestedPort}`)
}
// '' when the site is served at the root, '/some/prefix' otherwise.
const baseSegments = config.base.split('/').filter(Boolean)
const basePath = baseSegments.length > 0 ? `/${baseSegments.join('/')}` : ''
const redirects = new Map()
const vercelJson = path.join(distDir, 'vercel.json')
if (existsSync(vercelJson)) {
  for (const rule of JSON.parse(readFileSync(vercelJson, 'utf8')).redirects ?? []) {
    redirects.set(rule.source, rule)
  }
}
let boundPort = requestedPort
const allowedHosts = () => new Set([`127.0.0.1:${boundPort}`, `localhost:${boundPort}`])

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  // WebAssembly.instantiateStreaming refuses anything else, so serving the
  // dialect module as octet-stream would silently drop the playground onto its
  // slower fallback path here but not in production.
  '.wasm': 'application/wasm',
}

function reject(response, status, message) {
  response
    .writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    .end(JSON.stringify({ error: message }))
}

const server = http.createServer((request, response) => {
  if (!allowedHosts().has(String(request.headers.host ?? '').toLowerCase())) {
    reject(response, 421, 'loopback Host required')
    return
  }
  let url
  try {
    url = new URL(request.url, `http://${request.headers.host}`)
  } catch {
    reject(response, 400, 'malformed URL')
    return
  }
  // The build nests the site under the base path inside dist, with robots.txt
  // and vercel.json at the root, so URL paths map straight into the output
  // directory exactly as they do in production.
  let publicPath
  try {
    publicPath = decodeURIComponent(url.pathname || '/')
  } catch {
    reject(response, 400, 'malformed path encoding')
    return
  }
  const redirect = redirects.get(publicPath.replace(/(.)\/$/, '$1'))
  if (redirect) {
    response
      .writeHead(redirect.permanent ? 308 : 307, { Location: redirect.destination, 'Cache-Control': 'no-store' })
      .end()
    return
  }
  let filePath = path.join(distDir, path.normalize(publicPath))
  const relative = path.relative(distDir, filePath)
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    response.writeHead(403).end('Forbidden')
    return
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html')
  }
  if (!existsSync(filePath) && !path.extname(filePath) && existsSync(`${filePath}.html`)) {
    filePath = `${filePath}.html`
  }
  if (!existsSync(filePath)) {
    response.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found')
    return
  }
  response.writeHead(200, {
    'Content-Type': types[path.extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  })
  createReadStream(filePath).pipe(response)
})

server
  .listen(requestedPort, '127.0.0.1', () => {
    boundPort = server.address().port
    console.log(`docs served at http://127.0.0.1:${boundPort}${basePath}/`)
  })
  .on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`port ${requestedPort} is already in use, pass another: node docs/serve.mjs <port>`)
      process.exit(1)
    }
    throw error
  })
