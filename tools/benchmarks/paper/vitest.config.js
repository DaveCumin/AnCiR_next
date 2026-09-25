// Stand-alone Vitest config for the paper accuracy benchmark.
//
// Deliberately separate from the project's vite.config.js: that config only
// includes src/** and scripts/**, so these files NEVER run in the normal suite.
// Run explicitly with (from the repo root):
//
//   RUN_PAPER_BENCH=1 pnpm vitest run --config tools/benchmarks/paper/vitest.config.js
//
// Every test file is additionally gated on RUN_PAPER_BENCH=1 (describe.skipIf).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

export default defineConfig({
	root: repoRoot,
	resolve: {
		alias: { $lib: path.join(repoRoot, 'src/lib') }
	},
	test: {
		environment: 'node',
		include: ['tools/benchmarks/paper/**/*.bench.test.js'],
		testTimeout: 60 * 60 * 1000,
		hookTimeout: 60 * 60 * 1000,
		pool: 'forks',
		fileParallelism: true
	}
});
