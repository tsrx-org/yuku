type A = import("foo", { with: { "resolution-mode": "require" } }).ns.Bar<string, number>;
type B = typeof import("foo", { with: { type: "json" } }).value;