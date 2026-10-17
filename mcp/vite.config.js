import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Standalone Vite config for the MCP workspace.
//
// The AnCiR app's own vite.config.js uses the SvelteKit plugin (which is bound
// to the routes/ structure). Here we only need to compile Svelte modules and
// resolve the `$lib` alias so we can import AnCiR's real engine code
// (core, columns, table-process functions) outside the app.
const lib = fileURLToPath(new URL('../src/lib', import.meta.url));
// The engine code (and the icons it imports as `?raw`) lives in the parent AnCiR
// repo, outside this mcp/ dir. Vitest serves modules through Vite's dev server,
// whose fs allow-list defaults to the project root — so the parent repo must be
// allowed explicitly or imports of ../src/lib/** are denied. (vite-node, used by
// `npm start`, doesn't enforce this, which is why the server runs without it.)
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
	plugins: [
		// configFile:false — don't pick up the app's SvelteKit svelte.config.js.
		// AnCiR source is plain JS Svelte (no <script lang="ts">), so no preprocess
		// is required; Svelte 5 auto-detects runes in .svelte/.svelte.js modules.
		svelte({ configFile: false })
	],
	resolve: {
		alias: { $lib: lib }
	},
	server: {
		fs: { allow: [repoRoot] },
		// No file watcher outside vitest. vite-node (gen-schema, the MCP server and its
		// workers) asks Vite for `watch: null`, but Vite's mergeConfig skips null values, so
		// that request is silently dropped and a real chokidar watcher runs. Every module
		// imported from ../src/lib (outside this root) is then `watcher.add`ed, and on macOS
		// each add starts an fsevents instance asynchronously. When the script finishes,
		// vite-node closes the server while some adds are still in flight; an fsevents
		// instance created after close() is never stopped and keeps Node alive forever.
		// That hung `npm run mcp:schema` (and so the release gate and `npm run build`)
		// intermittently, more often as the app grew. A null set HERE survives the merge.
		// Under vitest, leave it alone: vitest sets its own watch mode (run vs watch).
		watch: process.env.VITEST ? undefined : null
	},
	test: {
		environment: 'happy-dom',
		include: ['test/**/*.{test,spec}.js'],
		// AnCiR's reactive engine is a module singleton; run test files serially
		// in a single worker so they don't fight over shared `core` state.
		fileParallelism: false
	}
});
