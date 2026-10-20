type A = import("foo", { with: { type: "json" } });
type B = import("foo", { with: { "resolution-mode": "import" } }).Bar;
let c: typeof import("foo", { with: { type: "json" } });