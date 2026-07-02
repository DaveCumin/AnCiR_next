import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),

		// `$tools` → the repo-root tools/ dir, so the browser can lazily `?raw`-import
		// the canonical Python runtime (tools/ancir_runtime.py) for the experimental
		// "export session as Python" feature — keeping a single source of truth.
		alias: {
			$tools: 'tools'
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
