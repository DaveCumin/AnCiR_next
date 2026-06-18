import { sveltekit } from '@sveltejs/kit/vite';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

export default defineConfig({
	build: {
		assetsInlineLimit: Infinity
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
