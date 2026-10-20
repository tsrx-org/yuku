// The home panel's source and the playground's examples. build.mjs parses each
// one with @tsrx/yuku and fails when the result differs from `error`.
export const heroCode = `export function Cart({ items }): unknown @{
  const count = items.length;
  <ul class="cart">
    @for (const item of items; key item.id) {
      <li>{item.label}</li>
    } @empty {
      <li>Your cart is empty</li>
    }
    @if (count > 0) { <li>{count} in the cart</li> }
    <style>.cart { display: grid; gap: 4px; }</style>
  </ul>
}`

export const examples = [
  {
    id: 'code-block',
    label: 'Code block',
    note: 'A code block runs its statements, then renders one node.',
    source: `export function Greeting({ name }) @{
  const upper = name.toUpperCase();
  <p>Hello, {upper}</p>
}`,
  },
  {
    id: 'if-else',
    label: 'If / else',
    note: '`@else if` is an IfStatement in the alternate of the JSXIfExpression, as in @tsrx/core.',
    source: `export function Status({ count }) @{
  <p>
    @if (count === 0) {
      <span>Nothing yet</span>
    } @else if (count === 1) {
      <span>One item</span>
    } @else {
      <span>{count} items</span>
    }
  </p>
}`,
  },
  {
    id: 'for',
    label: 'For',
    note: 'A JSXForExpression with its index, key, and @empty block.',
    source: `export function List({ items }) @{
  <ol>
    @for (const item of items; index i; key item.id) {
      <li>{i + 1}. {item.name}</li>
    } @empty {
      <li>No items</li>
    }
  </ol>
}`,
  },
  {
    id: 'switch',
    label: 'Switch',
    note: 'A JSXSwitchExpression whose cases are standard SwitchCase nodes.',
    source: `export function Badge({ level }) @{
  @switch (level) {
    @case 'warn': {
      <b class="warn">Warning</b>
    }
    @case 'error': {
      <b class="error">Error</b>
    }
    @default: {
      <b>Info</b>
    }
  }
}`,
  },
  {
    id: 'try',
    label: 'Try',
    note: 'A JSXTryExpression with @pending and a @catch that takes the error and a reset.',
    source: `export function Profile({ user }) @{
  @try {
    <UserCard user={user} />
  } @pending {
    <p>Loading</p>
  } @catch (error, reset) {
    <button onClick={reset}>{error.message}</button>
  }
}`,
  },
  {
    id: 'dynamic-tag',
    label: 'Dynamic tag',
    note: 'An element whose name is an expression: <{tag}>.',
    source: `export function Heading({ level, children }) @{
  const tag = 'h' + level;
  <{tag} class="heading">{children}</{tag}>
}`,
  },
  {
    id: 'style',
    label: 'Style element',
    note: 'A JSXStyleElement keeps its CSS as one JSXText. CSS trees come in 0.9.',
    source: `export function Card({ title }) @{
  <section class="card">
    <h2>{title}</h2>
    <style>
      .card { padding: 1rem; border-radius: 8px; }
      h2 { margin: 0; }
    </style>
  </section>
}`,
  },
  {
    id: 'two-nodes',
    label: 'Invalid: two nodes',
    note: 'A code block renders a single node, so two need a fragment: TSRX2011.',
    error: 'TSRX2011',
    source: `export function Pair() @{
  <h1>Title</h1>
  <p>Body</p>
}`,
  },
]
