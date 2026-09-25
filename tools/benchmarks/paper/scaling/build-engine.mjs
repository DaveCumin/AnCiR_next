// Bundle engine-entry.mjs with esbuild so it can run in plain Node (no Vite).
// - `$lib/...` resolves to src/lib/...
// - `$lib/core/core.svelte` (imported transitively by utils/time/displayTime.js for
//   the display timezone) is replaced by a tiny stub, because Svelte runes cannot
//   run outside the Svelte compiler. The benchmarked functions (getUNIXDate,
//   guessDateofArray) do not read it.
import { build } from 'esbuild';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../..');
const srcLib = path.join(repo, 'src/lib');
const outfile = path.join(here, '.cache/engine.bundle.mjs');

const exts = ['', '.js', '.mjs', '/index.js'];
const libPlugin = {
	name: 'sveltekit-lib',
	setup(b) {
		b.onResolve({ filter: /^\$lib\/core\/core\.svelte(\.js)?$/ }, () => ({
			path: 'core-stub',
			namespace: 'stub'
		}));
		b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
			contents: "export const appState = { displayTimezone: 'utc' }; export const core = {};",
			loader: 'js'
		}));
		b.onResolve({ filter: /^\$lib\// }, (args) => {
			const base = path.join(srcLib, args.path.slice(5));
			for (const e of exts) {
				if (fs.existsSync(base + e) && fs.statSync(base + e).isFile()) return { path: base + e };
			}
			return { errors: [{ text: 'cannot resolve ' + args.path }] };
		});
	}
};

await build({
	entryPoints: [path.join(here, 'engine-entry.mjs')],
	bundle: true,
	platform: 'node',
	format: 'esm',
	target: 'node20',
	outfile,
	nodePaths: [path.join(repo, 'node_modules')],
	plugins: [libPlugin],
	banner: {
		js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
	},
	logLevel: 'warning'
});
console.log('built', path.relative(repo, outfile));
