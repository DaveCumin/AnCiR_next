import { sveltekit } from '@sveltejs/kit/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		assetsInlineLimit: Infinity
	},

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

	// Honour a PORT injected by the environment (e.g. the preview harness) so the
	// dev server listens where the proxy expects. Falls back to Vite's default.
	server: process.env.PORT
		? { port: Number(process.env.PORT), strictPort: true }
		: undefined,

	plugins: [
		sveltekit(),
		visualizer({
			emitFile: true,
			filename: 'stats.html'
		})
	],

	test: {
		environment: 'happy-dom',
		setupFiles: ['./src/test/setup.js'],
		include: ['src/**/*.{test,spec}.{js,svelte}'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			include: ['src/lib/utils/**', 'src/lib/data/**'],
			thresholds: { lines: 100, functions: 100 }
		}
	}
});
