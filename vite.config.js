import { sveltekit } from '@sveltejs/kit/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { writeSidecar as writePythonSidecar } from './scripts/buildPythonExport.mjs';
import { writeSidecar as writeRSidecar } from './scripts/buildRExport.mjs';

export default defineConfig({
	build: {
		assetsInlineLimit: Infinity
	},

	// Vitest's vite-node always transforms modules in SSR mode, so without this,
	// Svelte components compile to their server (SSR) output and
	// @testing-library/svelte's `render()`/`mount()` fails with
	// "mount(...) is not available on the server". Forcing the `browser`
	// resolve condition under Vitest makes component-render tests use the
	// client-compiled component instead. Scoped to VITEST so it never affects
	// the production build.
	resolve: process.env.VITEST ? { conditions: ['browser'] } : undefined,

	// Node components (plots / table-processes) are loaded LAZILY via
	// import.meta.glob(..., { eager: false }), so Vite's dep scanner never sees
	// THEIR dependencies at startup. The first time a node is loaded at runtime,
	// Vite discovers these (mostly CommonJS @stdlib) packages, re-optimises deps,
	// and invalidates the page's already-served chunks — which surfaces as
	// "The file does not exist at .../.vite/deps/chunk-*.js" and makes the node's
	// dynamic import fail, so it silently drops out of the palette (Cosinor,
	// Actogram, Periodogram, …). Pre-bundling them up front avoids the mid-session
	// re-optimisation entirely.
	optimizeDeps: {
		include: [
			'@stdlib/random-base-minstd-shuffle',
			'@stdlib/random-base-exponential',
			'@stdlib/random-base-normal',
			'@stdlib/random-base-uniform',
			'@stdlib/stats-base-dists-chisquare-cdf',
			'@stdlib/stats-base-dists-chisquare-quantile',
			'@stdlib/stats-base-dists-f-cdf',
			'@stdlib/stats-base-dists-t-quantile',
			'd3-scale',
			'd3-time-format',
			'dayjs',
			'dayjs/plugin/customParseFormat',
			'dayjs/plugin/timezone',
			'dayjs/plugin/utc',
			'fflate'
		]
	},

	// A dev server started with PORT set (the preview harness / an agent session) gets its
	// OWN dep cache.
	//
	// `server.port` is part of the config Vite hashes to name the optimised-dep URLs
	// (`?v=<hash>`), so a harness server on a different port re-optimises into the SHARED
	// node_modules/.vite and hands the deps a new hash. Any OTHER dev server already running
	// against this repo then keeps requesting the old hash and gets `504 (Outdated Optimize
	// Dep)` on dayjs, d3 and friends, which SvelteKit surfaces as a bare "500 Internal
	// Error" — the page's dynamic import of the route module fails and there is nothing
	// left to render.
	//
	// It cost two debugging sessions, and the tell is that the deps 504 while every source
	// module still serves 200. Isolating the cache means a second server can come and go
	// without touching the one a person is using.
	cacheDir: process.env.PORT ? `node_modules/.vite-port-${process.env.PORT}` : undefined,

	// Honour a PORT injected by the environment (e.g. the preview harness) so the
	// dev server listens where the proxy expects. Falls back to Vite's default.
	server: {
		// Allow the dev server to serve tools/ancir_runtime.py (which lives outside
		// src/) for the experimental "export session as Python" `?raw` import. This
		// restores serving from the workspace root and only affects dev — the
		// production build reads the file directly at build time.
		fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
		...(process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {})
	},

	plugins: [
		// Regenerate the export sidecars from their canonical sources before anything is served
		// or bundled. A plugin rather than a package.json step so dev and build agree: they are
		// gitignored (derived), so a fresh checkout running `pnpm dev` would otherwise have no
		// sidecars and two dead export buttons.
		{
			name: 'ancir-export-sidecars',
			buildStart() {
				for (const write of [writePythonSidecar, writeRSidecar]) {
					const { path, bytes, changed } = write();
					if (changed) console.log(`  ↳ ${path} (${(bytes / 1024).toFixed(0)} KB, regenerated)`);
				}
			}
		},
		sveltekit(),
		visualizer({
			emitFile: true,
			filename: 'stats.html'
		})
	],

	test: {
		environment: 'happy-dom',
		setupFiles: ['./src/test/setup.js'],
		// scripts/ is included so the build tooling (e.g. the Python-export sidecar
		// generator) is covered by the same suite as the app.
		include: ['src/**/*.{test,spec}.{js,svelte}', 'scripts/**/*.{test,spec}.{js,mjs}'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/lib/utils/**', 'src/lib/data/**'],
			thresholds: { lines: 100, functions: 100 }
		}
	}
});
