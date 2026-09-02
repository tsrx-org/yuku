// Site configuration for the static docs generator (yuku-website/build.mjs).

// https://yuku.tsrx.dev is the canonical home, at the root of its own domain.
// SITE_ORIGIN and SITE_BASE override that for a build aimed at a legacy
// location (the old https://compiled.run/yuku-tsrx); such a build carries
// `redirectTo`, which yuku-website/build.mjs turns into permanent redirects from its
// base path to the same paths on the canonical origin. The canonical build has
// no redirectTo and redirects nothing, so it cannot loop.
const CANONICAL_ORIGIN = 'https://yuku.tsrx.dev'

const origin = (process.env.SITE_ORIGIN ?? CANONICAL_ORIGIN).trim().replace(/\/+$/, '')
if (!/^https?:\/\/[^/\s]+$/.test(origin)) {
  throw new Error(`SITE_ORIGIN must be a scheme and host with no path, got: ${process.env.SITE_ORIGIN}`)
}

// Root-absolute with a trailing slash; '', '/' and '///' all mean the root.
const normalizeBase = (value) => {
  const segments = value.trim().split('/').filter(Boolean)
  return segments.length > 0 ? `/${segments.join('/')}/` : '/'
}
const base = normalizeBase(process.env.SITE_BASE ?? '/')

export default {
  title: 'yuku-tsrx',
  description:
    'Parse, analyze and print TSRX with the Yuku parser. @tsrx/yuku is a dialect on Yuku, not a fork.',
  origin,
  base,
  // Canonical origin every page under `base` should permanently redirect to,
  // or null when this build is the canonical one.
  redirectTo: origin === CANONICAL_ORIGIN ? null : CANONICAL_ORIGIN,
  repository: 'https://github.com/tsrx-org/yuku',
  // The one page that is not markdown: rendered by build.mjs from the fixtures.
  playground: '/playground',
  nav: [
    { text: 'Guide', link: '/guide/quick-start' },
    { text: 'Playground', link: '/playground' },
    { text: 'Architecture', link: '/architecture/dialect' },
    { text: 'Reference', link: '/reference/api' },
    { text: 'GitHub', link: 'https://github.com/tsrx-org/yuku' },
  ],
  sidebar: [
    {
      text: 'Guide',
      items: [
        { text: 'Quick start', link: '/guide/quick-start' },
        { text: 'Oxc or Yuku?', link: '/guide/oxc-or-yuku' },
        { text: 'Build from source', link: '/guide/build-from-source' },
        { text: 'Parse', link: '/guide/parse' },
        { text: 'Diagnostics and recovery', link: '/guide/diagnostics' },
        { text: 'Analyze', link: '/guide/analyze' },
        { text: 'Generate', link: '/guide/generate' },
        { text: 'Walk and transform', link: '/guide/walk' },
      ],
    },
    {
      text: 'Architecture',
      items: [
        { text: 'How the dialect works', link: '/architecture/dialect' },
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'Benchmarks', link: '/reference/benchmarks' },
        { text: 'API', link: '/reference/api' },
        { text: 'Platforms and versions', link: '/reference/platforms' },
        { text: 'Limitations', link: '/reference/limitations' },
      ],
    },
  ],
  // Routes that once existed. The build writes each as a permanent redirect in
  // vercel.json and rewrites in-page links to the destination; links from the
  // README and from Markless keep landing.
  redirects: {
    '/guide/introduction': '/guide/quick-start',
    '/guide/getting-started': '/guide/quick-start',
    '/guide/tsrx-syntax': '/guide/parse',
    '/guide/tsrx': '/guide/parse',
    '/guide/parser': '/guide/parse',
    '/guide/analyzer': '/guide/analyze',
    '/guide/codegen': '/guide/generate',
    '/architecture/yuku-dialect': '/architecture/dialect',
    '/architecture/upstreaming-to-yuku': '/architecture/dialect',
    '/architecture/upstream': '/architecture/dialect',
    '/reference/platform-support': '/reference/platforms',
  },
  hero: {
    name: 'yuku-tsrx',
    text: 'Parse, analyze and print TSRX with the Yuku parser',
    tagline:
      'Type below and watch the tree follow.',
    actions: [
      { theme: 'brand', text: 'Quick start', link: '/guide/quick-start' },
      { theme: 'alt', text: 'Open the playground', link: '/playground' },
    ],
  },
  features: [
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 8.5v7a2 2 0 0 1-1 1.73l-6 3.5a2 2 0 0 1-2 0l-6-3.5A2 2 0 0 1 5 15.5v-7a2 2 0 0 1 1-1.73l6-3.5a2 2 0 0 1 2 0l6 3.5a2 2 0 0 1 1 1.73Z"/><path d="m5.3 7.3 7.7 4.5 7.7-4.5M13 21.5V11.8"/></svg>',
      title: 'It\'s <a href="https://yuku.fyi">Yuku</a>, with TSRX added',
      details:
        'Yuku already parses TypeScript. This package adds the handful of TSRX rules on top, so nothing is forked and nothing goes stale.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3.5H7a2 2 0 0 0-2 2V10a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4.5a2 2 0 0 0 2 2h1"/><path d="M16 20.5h1a2 2 0 0 0 2-2V14a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5.5a2 2 0 0 0-2-2h-1"/></svg>',
      title: 'Parse a file, get the whole picture',
      details:
        'One call gives you the syntax tree, the comments, and every error with its position. Nothing throws unless you ask it to.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/></svg>',
      title: 'Ask what a name points at',
      details:
        'Scopes, symbols and references are linked into flat tables as soon as a file is parsed, so a compiler asks what a name points at instead of walking the tree to find out.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 20V8m0 0L3.5 11.5M7 8l3.5 3.5M17 4v12m0 0 3.5-3.5M17 16l-3.5-3.5"/></svg>',
      title: 'Turn the tree back into code',
      details:
        'Change the tree, print it out. Keep the types or strip them, keep the comments or drop them, pretty or tiny.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z"/></svg>',
      title: 'Your @if stays an @if',
      details:
        'The tree names TSRX constructs by what you wrote, not by a plain-TSX translation, so your tooling can look for them directly.',
    },
    {
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5 4 7v5.5c0 4.4 3.2 7.6 8 8.9 4.8-1.3 8-4.5 8-8.9V7Z"/><path d="m9 12 2.2 2.2L15.5 10"/></svg>',
      title: 'Try it right here',
      details:
        'The same parser is compiled to WebAssembly and runs on every page of this site. Every example is parsed live in your browser.',
    },
  ],
  footer: {
    // No license has been chosen for this repository, so the footer states none.
    // Leave empty until a LICENSE file exists; build.mjs omits the badge when empty.
    copyright: '',
  },
}
