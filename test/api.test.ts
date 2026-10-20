import { expect, test } from "bun:test";
import { Analyzer, BindingFlags, parse } from "@tsrx/yuku";

const texts = (source: string) => {
  const { program, diagnostics } = parse(source, { path: "App.tsrx" });
  expect(diagnostics).toEqual([]);
  const found: string[] = [];
  JSON.stringify(program, (_, node) => {
    if (node?.type === "JSXText" && node.raw.trim() !== "") found.push(node.raw);
    return node;
  });
  return found;
};

test("quotes, backticks, and URLs in the text of an `@if` arm are text", () => {
  for (const text of ["it's", 'say "hi"', "a `tick", "http://x.y"]) {
    expect(texts(`export const A = () => @{ @if (x) { <span>${text}</span> } @else { <i>${text}</i> } }`)).toEqual([text, text]);
    expect(texts(`export const A = () => <div>@if (x) { <span>${text}</span> }</div>`)).toEqual([text]);
  }
});

test("`//` in the text of an `@if` arm starts a comment, as in @tsrx/core", () => {
  expect(texts("export const A = () => @{ @if (x) { <span>don't // stop\n</span> } }")).toEqual(["don't "]);
});

test("Analyzer reads TSRX files", () => {
  const analyzer = new Analyzer();
  analyzer.setFile("/app/b.tsrx", "export const B = () => <p>{1}</p>");
  const app = analyzer.setFile("/app/a.tsrx", 'import { B } from "./b.tsrx"; export const A = () => @{ <B /> }');
  expect(app.diagnostics).toEqual([]);
  expect(typeof BindingFlags.BlockScopedVariable).toBe("number");
});
