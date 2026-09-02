// The TSRX snippet the home page hero panel shows and parses live in the tab.
// tools/wasm-smoke.mjs and the how-it-works stepper read the same export.
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
