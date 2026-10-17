import adapter from '@sveltejs/adapter-static';
import { buildOutputDirs } from './scripts/buildOutput.js';

// build/ and .svelte-kit unless ANCIR_BUILD_DIR / ANCIR_KIT_DIR say otherwise (only the e2e
// web server in playwright.config.js sets them, so its build never overwrites build/).
const { pages, kitOutDir } = buildOutputDirs(process.env);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter({ pages, assets: pages }),
		outDir: kitOutDir,

		// `$tools` → the repo-root tools/ dir, so the browser can lazily `?raw`-import
		// the canonical Python runtime (tools/ancir_runtime.py) for the experimental
		// "export session as Python" feature — keeping a single source of truth.
		alias: {
			$tools: 'tools',

			// `$test` → src/test, the shared test-only helpers (see plotRegistry.js).
			$test: 'src/test'
		},

		output: {
			bundleStrategy: 'inline'
		},

		router: {
			type: 'hash'
		}
	},
	vitePlugin: {
		inspector: true
	}
};

export default config;
