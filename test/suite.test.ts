import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { ParseResult } from "yuku";
import { generate, parse } from "yuku-tsrx";

const errors = ({ diagnostics }: ParseResult) =>
  diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

for (const kind of ["pass", "fail"]) {
  const dir = new URL(`suite/${kind}/`, import.meta.url);
  test.each(readdirSync(dir))(`${kind}/%s`, (name) => {
    const source = readFileSync(new URL(name, dir), "utf8");
    const result = parse(source, { path: name, semanticErrors: true });
    if (kind === "fail") {
      expect(errors(result)).not.toEqual([]);
      return;
    }
    expect(errors(result)).toEqual([]);

    const { code } = generate(result.program);
    const printed = parse(code, { path: name });
    expect(errors(printed)).toEqual([]);
    expect(generate(printed.program).code).toBe(code);
  });
}
