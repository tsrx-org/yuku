// Deterministic SVG asset generation for the docs site. Run: node yuku-website/generate-assets.mjs
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const assetsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets')

// ---------- hero band: deep orange field with radiating light streaks ----------
// Deterministic pseudo-random from a fixed seed so regeneration is stable.
function mulberry32(seed) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rand = mulberry32(20260716)
const width = 1600
const height = 720
const cx = width / 2
const cy = height * 0.62

let streaks = ''
for (let i = 0; i < 120; i++) {
  const angle = rand() * Math.PI * 2
  const inner = 140 + rand() * 190
  const length = 260 + rand() * 620
  const spread = 0.55 + rand() * 2.6
  const x1 = cx + Math.cos(angle) * inner
  const y1 = cy + Math.sin(angle) * inner * 0.62
  const x2 = cx + Math.cos(angle) * (inner + length)
  const y2 = cy + Math.sin(angle) * (inner + length) * 0.62
  // A minority of streaks run cool sky so they stay visible against the
  // deep orange field; the rest are the pale warm tint of the brand ramp.
  const cool = rand() < 0.22
  const color = cool ? '#BAE6FD' : '#FFEDD5'
  const opacity = (cool ? 0.10 : 0.09) + rand() * 0.10
  streaks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${spread.toFixed(2)}" stroke-linecap="round" opacity="${opacity.toFixed(3)}"/>`
}

const rays = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="base" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#C2410C"/>
      <stop offset="0.5" stop-color="#EA580C"/>
      <stop offset="1" stop-color="#7C2D12"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.62" r="0.75">
      <stop offset="0" stop-color="#FB923C" stop-opacity="0.55"/>
      <stop offset="0.45" stop-color="#F97316" stop-opacity="0.25"/>
      <stop offset="1" stop-color="#F97316" stop-opacity="0"/>
    </radialGradient>
    <filter id="soften" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="1.4"/>
    </filter>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#base)"/>
  <g filter="url(#soften)">${streaks}</g>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>
</svg>
`

// ---------- site logo: an at-mark on the orange brand gradient ----------
const GRAD = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
  <stop offset="0" stop-color="#F97316"/>
  <stop offset="0.55" stop-color="#EA580C"/>
  <stop offset="1" stop-color="#9A3412"/>
</linearGradient>`

// Path-drawn @ centered on (32,32): inner ring, tail, open outer arc.
const AT_PATH = `<g fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round">
    <circle cx="32" cy="32" r="7"/>
    <path d="M39 32 v4 a4.5 4.5 0 0 0 9 0 v-4 a16 16 0 1 0 -6 12.5"/>
  </g>`

const SQUARE = '<rect width="64" height="64" rx="15" fill="url(#g)"/>'

const logo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="yuku-tsrx logo">
  <defs>${GRAD}</defs>
  ${SQUARE}
  ${AT_PATH}
</svg>
`

await writeFile(path.join(assetsDir, 'logo.svg'), logo)
await writeFile(path.join(assetsDir, 'hero-rays.svg'), rays)
console.log('wrote assets/logo.svg and assets/hero-rays.svg')
