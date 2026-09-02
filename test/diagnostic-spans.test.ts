import { expect, test } from "vitest";
import { analyze, authoredDiagnosticSpan, parseModule, type Diagnostic } from "@tsrx/yuku";

// The seam that assigns these spans (yuku-minimal-seam
// src/parser/syntax/jsx/root.zig:282) points a malformed-markup diagnostic at
// the token it choked on rather than at the markup the author wrote. Markless
// re-derived the authored span downstream; these cases pin the package-level
// policy to that downstream function byte for byte, so deleting the consumer
// copy is a no-op. Anything the two rules below do not cover stays untouched --
// that is the upstream follow-up's business, not this shim's.

/** Mismatched closing tag: the seam points at the tag name, not at its `</`. */
const MISMATCHED_CLOSING_TAG = "export function A() { return <div></span></div>; }";

/** Doubled closing angle: the seam points past the stray `>`, at the next token. */
const DOUBLED_CLOSING_ANGLE = "export function B() { return <div></div>>; }";

/** Self-closing tag followed by a stray `>`: deliberately NOT compensated. */
const SELF_CLOSING_EXTRA_ANGLE = "export function C() { return <br/>>; }";

/** A stray `>` in JSX text: the control case, already pointed at the right char. */
const JSX_TEXT_STRAY_ANGLE = "export function D() { return <div>a > b</div>; }";

const collect = (source: string, filename: string): Diagnostic[] => {
	const errors: Diagnostic[] = [];
	parseModule(source, filename, { collect: true, errors });
	return errors;
};

const span = (start: number, end: number) => ({ start, end });

test("a mismatched closing tag reports from its `</`, not from the tag name", () => {
	// Seam span is [36, 40] -- "span", the name alone.
	expect(authoredDiagnosticSpan({ start: 36, end: 40 }, MISMATCHED_CLOSING_TAG)).toEqual(
		span(34, 40),
	);
	expect(MISMATCHED_CLOSING_TAG.slice(34, 40)).toBe("</span");
});

test("a doubled closing angle reports from the extra `>`, not from the next token", () => {
	// Seam span is [41, 42] -- ";", the token after the stray angle.
	expect(authoredDiagnosticSpan({ start: 41, end: 42 }, DOUBLED_CLOSING_ANGLE)).toEqual(
		span(40, 42),
	);
	// The slice still swallows the following token. That is the downstream
	// function's behavior, and parity with it is this round's contract.
	expect(DOUBLED_CLOSING_ANGLE.slice(40, 42)).toBe(">;");
});

test("the doubled-angle rule survives whitespace between the markup and the next token", () => {
	const source = "export function B() { return <div></div>>  ; }";
	// Seam span is [43, 44]; the match is "</div>>  ", whose last `>` sits at 40.
	expect(authoredDiagnosticSpan({ start: 43, end: 44 }, source)).toEqual(span(40, 44));
});

test("a self-closing tag with a stray `>` is left exactly where the seam put it", () => {
	// No consumer compensates for this shape, so the shim must not invent a
	// policy for it. `<br/>` is not `</br>`, so neither rule fires.
	expect(authoredDiagnosticSpan({ start: 35, end: 36 }, SELF_CLOSING_EXTRA_ANGLE)).toEqual(
		span(35, 36),
	);
	expect(SELF_CLOSING_EXTRA_ANGLE.slice(35, 36)).toBe(";");
});

test("a stray `>` in JSX text is left exactly where the seam put it", () => {
	expect(authoredDiagnosticSpan({ start: 36, end: 37 }, JSX_TEXT_STRAY_ANGLE)).toEqual(
		span(36, 37),
	);
	expect(JSX_TEXT_STRAY_ANGLE.slice(36, 37)).toBe(">");
});

test("spans are clamped to the source bounds instead of escaping them", () => {
	const source = "<div></div>";

	// Both endpoints past the end.
	expect(authoredDiagnosticSpan({ start: 100, end: 200 }, source)).toEqual(
		span(source.length, source.length),
	);
	// Both endpoints below zero.
	expect(authoredDiagnosticSpan({ start: -5, end: -1 }, source)).toEqual(span(0, 0));
	// An inverted span collapses onto its clamped start rather than running backwards.
	expect(authoredDiagnosticSpan({ start: 6, end: 2 }, source)).toEqual(span(6, 6));
	// Clamping happens before the rules read the source, so a clamped start can
	// still land on a `</` and shift.
	expect(authoredDiagnosticSpan({ start: 9_000, end: 9_000 }, "x</").start).toBe(1);
	// A start of 0 has no two characters behind it and must not wrap around.
	expect(authoredDiagnosticSpan({ start: 0, end: 1 }, "</").start).toBe(0);
});

test("parseModule hands collected errors the authored spans", () => {
	const [mismatched] = collect(MISMATCHED_CLOSING_TAG, "mismatched.tsrx");
	expect(mismatched.start).toBe(34);
	expect(mismatched.end).toBe(40);
	expect(MISMATCHED_CLOSING_TAG.slice(mismatched.start, mismatched.end)).toBe("</span");

	const [doubled] = collect(DOUBLED_CLOSING_ANGLE, "doubled.tsrx");
	expect(doubled.start).toBe(40);
	expect(doubled.end).toBe(42);
	expect(DOUBLED_CLOSING_ANGLE.slice(doubled.start, doubled.end)).toBe(">;");
});

test("parseModule leaves the shapes neither rule covers alone", () => {
	const [selfClosing] = collect(SELF_CLOSING_EXTRA_ANGLE, "self-closing.tsrx");
	expect(selfClosing.start).toBe(35);
	expect(selfClosing.end).toBe(36);

	const [strayText] = collect(JSX_TEXT_STRAY_ANGLE, "stray-text.tsrx");
	expect(strayText.start).toBe(36);
	expect(strayText.end).toBe(37);
});

test("parseModule keeps everything about a diagnostic except its span", () => {
	const [mismatched] = collect(MISMATCHED_CLOSING_TAG, "mismatched.tsrx");
	expect(mismatched.severity).toBe("error");
	expect(mismatched.message).toContain("</span>");
	expect(Array.isArray(mismatched.labels)).toBe(true);
});

test("the throw path carries the authored span too", () => {
	expect(() => parseModule(MISMATCHED_CLOSING_TAG, "mismatched.tsrx")).toThrow("(34:40)");
	expect(() => parseModule(DOUBLED_CLOSING_ANGLE, "doubled.tsrx")).toThrow("(40:42)");
});

test("parseModule reads UTF-8 bytes for the span policy as well as strings", () => {
	const errors: Diagnostic[] = [];
	parseModule(new TextEncoder().encode(MISMATCHED_CLOSING_TAG), "mismatched.tsrx", {
		collect: true,
		errors,
	});
	expect(errors[0].start).toBe(34);
	expect(errors[0].end).toBe(40);
});

test("a clean module still parses with no diagnostics touched", () => {
	const errors: Diagnostic[] = [];
	const program = parseModule("export const a = <div>ok</div>;", "clean.tsrx", {
		collect: true,
		errors,
	});
	expect(errors).toHaveLength(0);
	expect(program.type).toBe("Program");
});

test("analyze's diagnostics path is untouched by the shim", () => {
	// analyze() reports the raw seam spans. Only parseModule applies the policy.
	const mismatched = analyze(MISMATCHED_CLOSING_TAG, "mismatched.tsrx").diagnostics;
	expect(mismatched[0].start).toBe(36);
	expect(mismatched[0].end).toBe(40);

	const doubled = analyze(DOUBLED_CLOSING_ANGLE, "doubled.tsrx").diagnostics;
	expect(doubled[0].start).toBe(41);
	expect(doubled[0].end).toBe(42);
});

/**
 * The downstream implementation this replaces, copied verbatim from markless
 * `packages/compiler/src/yuku-tsrx-adapter.ts` (`authoredDiagnosticSpan`). It
 * is duplicated here on purpose: the acceptance bar for this shim is that
 * deleting the consumer copy changes no span, and the only way to hold that
 * bar is to keep the thing being matched in the test and compare against it.
 */
function downstreamAuthoredDiagnosticSpan(
	diagnostic: { start: number; end: number },
	source: string,
): { start: number; end: number } {
	const start = Math.max(0, Math.min(source.length, diagnostic.start));
	const end = Math.max(start, Math.min(source.length, diagnostic.end));
	if (source.slice(start - 2, start) === "</") return { start: start - 2, end };

	const prefix = source.slice(0, start);
	const extraClosingAngle = prefix.match(/<\/[^<>\s]+>>\s*$/)?.[0].lastIndexOf(">");
	if (extraClosingAngle !== undefined) {
		return {
			start:
				prefix.length - (prefix.match(/<\/[^<>\s]+>>\s*$/)?.[0].length ?? 0) + extraClosingAngle,
			end,
		};
	}
	return { start, end };
}

test("matches the downstream implementation on every short source and span", () => {
	// An alphabet of exactly the characters the two rules can turn on -- angles,
	// slash, tag-name letters, and each flavor of whitespace -- so short strings
	// still cover `</`, `>>`, `<br/>>`, and trailing runs of space, tab, and
	// newline. Spans run three past both ends of each source to exercise the
	// clamps, including inverted ones.
	const alphabet = ["<", ">", "/", "d", "v", " ", "\t", "\n", ";"];
	let sources = [""];
	let compared = 0;

	for (let length = 1; length <= 4; length++) {
		sources = sources.flatMap((prefix) => alphabet.map((character) => prefix + character));
		for (const source of sources) {
			for (let start = -3; start <= source.length + 3; start++) {
				for (let end = -3; end <= source.length + 3; end++) {
					const actual = authoredDiagnosticSpan({ start, end }, source);
					const expected = downstreamAuthoredDiagnosticSpan({ start, end }, source);
					compared++;
					if (actual.start !== expected.start || actual.end !== expected.end) {
						// Only build the failure message when there is a failure; doing
						// it per comparison would dominate the runtime.
						expect({ source, start, end, actual }).toEqual({ source, start, end, expected });
					}
				}
			}
		}
	}

	// Guards the loop itself: a bug that emptied `sources` would otherwise let
	// this test pass having compared nothing.
	expect(compared).toBeGreaterThan(400_000);
});
