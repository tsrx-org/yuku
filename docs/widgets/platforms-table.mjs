// `<!-- widget:platforms-table -->`: one row per binding package, read from
// the manifests under npm/ and the CPU pins in the release-candidate workflow at build.
// A binding without a manifest, a pin, or the meta package's version fails the build.
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const MATRIX_ENTRY = /-\s*runner:\s*(\S+)\s*\n\s*binding:\s*(\S+)\s*\n\s*cpu:\s*(\S+)/g

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'))

export default async function render({ ctx }) {
  const packageDir = path.join(ctx.repoRoot, 'npm', 'yuku')
  const meta = await readJson(path.join(packageDir, 'package.json'))
  const scopeDir = path.join(packageDir, '@tsrx')
  const manifests = await Promise.all(
    (await readdir(scopeDir)).sort().map((dir) => readJson(path.join(scopeDir, dir, 'package.json'))),
  )
  const workflow = await readFile(path.join(ctx.repoRoot, '.github', 'workflows', 'release-candidate.yml'), 'utf8')
  const pins = new Map()
  for (const [, runner, binding, cpu] of workflow.matchAll(MATRIX_ENTRY)) {
    pins.set(`@tsrx/yuku-${binding}`, { runner, cpu })
  }
  const optional = Object.entries(meta.optionalDependencies ?? {})
  const names = new Set(manifests.map((manifest) => manifest.name))
  for (const [name, version] of optional) {
    if (!names.has(name)) throw new Error(`platforms-table: ${name} is an optionalDependency without a manifest under npm/`)
    if (version !== meta.version) {
      throw new Error(`platforms-table: ${name} is pinned to ${version}, but @tsrx/yuku is ${meta.version}`)
    }
    if (!pins.has(name)) throw new Error(`platforms-table: no cpu pin for ${name} in .github/workflows/release-candidate.yml`)
  }
  for (const manifest of manifests) {
    if (!meta.optionalDependencies?.[manifest.name]) {
      throw new Error(`platforms-table: ${manifest.name} has a manifest but is not an optionalDependency of @tsrx/yuku`)
    }
  }
  const rows = manifests
    .map((manifest) => {
      const pin = pins.get(manifest.name)
      const os = manifest.os?.join(', ') ?? ''
      const cpu = manifest.cpu?.join(', ') ?? ''
      const libc = manifest.libc?.join(', ') ?? ''
      return `<tr tabindex="0" data-platform-row data-os="${os}" data-cpu="${cpu}" data-libc="${libc}">
        <td><code>${ctx.escapeHtml(manifest.name)}</code></td>
        <td>${ctx.escapeHtml(os)}</td>
        <td>${ctx.escapeHtml(cpu)}</td>
        <td>${libc ? ctx.escapeHtml(libc) : '<span class="pt-none">any</span>'}</td>
        <td><code>-Dcpu=${ctx.escapeHtml(pin.cpu)}</code></td>
        <td><code>${ctx.escapeHtml(pin.runner)}</code></td>
        <td><code>${ctx.escapeHtml(manifest.engines?.node ?? '')}</code></td>
      </tr>`
    })
    .join('\n')
  return `<div class="table-wrap pt-table"><table>
<thead><tr><th>Package</th><th>OS</th><th>CPU</th><th>libc</th><th>CPU floor</th><th>Built on</th><th>Node</th></tr></thead>
<tbody>
${rows}
</tbody></table></div>
  <p class="pt-meta">Both are <code>optionalDependencies</code> of <code>${ctx.escapeHtml(meta.name)}</code> ${ctx.escapeHtml(meta.version)}, pinned to exactly ${ctx.escapeHtml(meta.version)}; the JavaScript package itself has no <code>os</code> or <code>cpu</code> field and needs Node <code>${ctx.escapeHtml(meta.engines?.node ?? '')}</code>.</p>
  <figcaption class="ex-status" data-widget-status aria-live="polite">with JavaScript on, this line says which row your browser matches</figcaption>`
}

export function markdown() {
  return 'On the site this table is read from the binding manifests under `npm/yuku/@tsrx/` and the CPU pins in `.github/workflows/release-candidate.yml` when the page builds, and your browser marks the row that matches your machine.'
}
