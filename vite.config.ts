import { defineConfig, type ViteUserConfig } from "vitest/config";
import type { OxfmtConfig } from "vite-plus/fmt";
import type { OxlintConfig } from "vite-plus/lint";

type VitePlusUserConfig = ViteUserConfig & {
	fmt?: OxfmtConfig;
	lint?: OxlintConfig;
};

const config = {
	fmt: {
		ignorePatterns: [
			"benchmarks/m5-corpus.json",
			"benchmarks/m5-pairs.json",
			"benchmarks/m6-baseline.json",
			"README.md",
			"yuku-website/**",
			"test/parser/misc/**",
			"npm/yuku/decode.js",
			"npm/yuku/decode-analyzer.js",
			"npm/yuku/encode.js",
		],
	},
	lint: {
		ignorePatterns: [
			"test/parser/misc/**",
			"npm/yuku/decode.js",
			"npm/yuku/decode-analyzer.js",
			"npm/yuku/encode.js",
		],
	},
	test: {
		include: ["test/**/*.test.ts"],
	},
} satisfies VitePlusUserConfig;

export default defineConfig(config);
