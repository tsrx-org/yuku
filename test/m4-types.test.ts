import { expectTypeOf, test } from "vitest";
import {
	analyze,
	generate,
	type AnalyzeResult,
	type GenerateResult,
	type Program,
} from "@tsrx/yuku";

test("analyze and generate are typed on the unified package", () => {
	expectTypeOf(analyze).returns.toEqualTypeOf<AnalyzeResult>();
	expectTypeOf(generate).parameter(0).toEqualTypeOf<Program>();
	expectTypeOf(generate).returns.toEqualTypeOf<GenerateResult>();
});
