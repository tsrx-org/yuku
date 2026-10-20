const icon = (paths) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

export default {
  title: 'Yuku for TSRX',
  description:
    'A fast TSRX parser, analyzer, and code generator, built on Yuku. One WebAssembly module for Node.js, Bun, Deno, Workers, and browsers.',
  origin: 'https://yuku.tsrx.dev',
  repository: 'https://github.com/tsrx-org/yuku',
  playground: '/playground',
  nav: [
    { text: 'Guide', link: '/guide/quick-start' },
    { text: 'Playground', link: '/playground' },
    { text: 'Benchmarks', link: '/reference/benchmarks' },
    { text: 'Reference', link: '/reference/api' },
    { text: 'GitHub', link: 'https://github.com/tsrx-org/yuku' },
  ],
  sidebar: [
    {
      text: 'Start here',
      items: [
        { text: 'Quick start', link: '/guide/quick-start' },
      ],
    },
    {
      text: 'Work with code',
      items: [
        { text: 'Parse', link: '/guide/parse' },
        { text: 'Analyze', link: '/guide/analyze' },
        { text: 'Generate', link: '/guide/generate' },
        { text: 'Diagnostics', link: '/guide/diagnostics' },
      ],
    },
    {
      text: 'Under the hood',
      items: [
        { text: 'How it works', link: '/architecture/how-it-works' },
        { text: 'Benchmarks', link: '/reference/benchmarks' },
      ],
    },
    {
      text: 'Reference',
      items: [
        { text: 'API', link: '/reference/api' },
        { text: 'Runtimes', link: '/reference/runtimes' },
      ],
    },
  ],
  // Older routes, sent to the page that covers the same ground.
  redirects: {
    '/guide/introduction': '/guide/quick-start',
    '/guide/getting-started': '/guide/quick-start',
    '/guide/oxc-or-yuku': '/guide/quick-start',
    '/guide/tsrx-syntax': '/guide/parse',
    '/guide/tsrx': '/guide/parse',
    '/guide/parser': '/guide/parse',
    '/guide/walk': '/guide/parse',
    '/guide/analyzer': '/guide/analyze',
    '/guide/codegen': '/guide/generate',
    '/guide/contributing': '/architecture/how-it-works',
    '/guide/build-from-source': '/architecture/how-it-works',
    '/architecture/dialect': '/architecture/how-it-works',
    '/architecture/yuku-dialect': '/architecture/how-it-works',
    '/architecture/upstreaming-to-yuku': '/architecture/how-it-works',
    '/architecture/upstream': '/architecture/how-it-works',
    '/reference/platforms': '/reference/runtimes',
    '/reference/platform-support': '/reference/runtimes',
    '/reference/limitations': '/reference/api',
    '/reference/testing': '/architecture/how-it-works',
  },
  hero: {
    name: 'Yuku for TSRX',
    text: 'Parse, analyze and print TSRX with the Yuku parser',
    tagline:
      'A TSRX parser, analyzer, and code generator, written in Zig on Yuku and shipped as one WebAssembly module. The tree is ESTree, with the node types of @tsrx/core.',
    actions: [
      { theme: 'brand', text: 'Quick start', link: '/guide/quick-start' },
      { theme: 'alt', text: 'Open the playground', link: '/playground' },
    ],
  },
  features: [
    {
      icon: icon('<path d="M13 2 4.5 13.5H11L9.5 22 19 10h-6.5L13 2Z"/>'),
      title: 'Fast',
      details:
        'Parses the TSRX test suite {{suiteSpeedup}}x faster than <code>@tsrx/core</code>, and the pages of tsrx.dev {{pagesSpeedup}}x faster. <a href="/reference/benchmarks">Benchmarks</a>',
    },
    {
      icon: icon('<path d="M8 3.5H7a2 2 0 0 0-2 2V10a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4.5a2 2 0 0 0 2 2h1"/><path d="M16 20.5h1a2 2 0 0 0 2-2V14a2 2 0 0 1 2-2 2 2 0 0 1-2-2V5.5a2 2 0 0 0-2-2h-1"/>'),
      title: 'The official node types',
      details:
        'ESTree, with TSRX\'s nodes named as <code>@tsrx/core</code> names them. Each of the {{suiteTotal}} sources of the test suite parses, or fails, as it does in <code>@tsrx/core</code>, except where that accepts what TypeScript rejects.',
    },
    {
      icon: icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
      title: 'Runs everywhere',
      details:
        'One WebAssembly module and no native addons: Node.js 16.4 or newer, Bun, Deno, Workers, and browsers. <a href="/reference/runtimes">Runtimes</a>',
    },
    {
      icon: icon('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.5" fill="currentColor"/>'),
      title: 'Scopes and bindings',
      details:
        'Yuku\'s semantic model for TSRX: scopes, bindings, references, imports, and exports, for one file or a whole project.',
    },
    {
      icon: icon('<path d="M7 20V8m0 0L3.5 11.5M7 8l3.5 3.5M17 4v12m0 0 3.5-3.5M17 16l-3.5-3.5"/>'),
      title: 'Back to source',
      details:
        'Print a program, or any node, back to TSRX, with formatting, type stripping, minification, and source maps.',
    },
    {
      icon: icon('<path d="M21 8.5v7a2 2 0 0 1-1 1.73l-6 3.5a2 2 0 0 1-2 0l-6-3.5A2 2 0 0 1 5 15.5v-7a2 2 0 0 1 1-1.73l6-3.5a2 2 0 0 1 2 0l6 3.5a2 2 0 0 1 1 1.73Z"/><path d="m5.3 7.3 7.7 4.5 7.7-4.5M13 21.5V11.8"/>'),
      title: 'A <a href="https://yuku.fyi/parser/dialect/">Yuku dialect</a>',
      details:
        'TSRX is one Zig file compiled into Yuku. Yuku parses, analyzes, and prints the JavaScript and TypeScript around it. <a href="/architecture/how-it-works">How it works</a>',
    },
  ],
}
