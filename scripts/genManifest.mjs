#!/usr/bin/env node
// Regenerates static/nodes.json from the live registry — a LOCAL release step of
// `npm run build`, mirroring `npm run mcp:schema`.
//
// It runs the GEN_MANIFEST-gated vitest generator (which needs the Svelte
// toolchain + happy-dom). That toolchain isn't present on CI / Cloudflare Pages,
// which install the root package only and run the same `npm run build` — so we
// skip there and let Pages bundle the committed nodes.json. nodeManifestFreshness
// .svelte.test.js keeps that committed file honest, so skipping on CI is safe.

import { execSync } from 'node:child_process';

if (process.env.CI) {
	console.log(
		'⏭  Regenerating static/nodes.json: skipped on CI (local release step; see scripts/genManifest.mjs).'
	);
	process.exit(0);
}

console.log('▶ Regenerating static/nodes.json from the live registry…');
try {
	execSync('npx vitest run src/lib/_demos/generateNodeManifest.svelte.test.js', {
		stdio: 'inherit',
		env: { ...process.env, GEN_MANIFEST: '1' }
	});
} catch {
	// Fail loudly: a silently-skipped regenerate ships a manifest that disagrees
	// with the app — the exact drift this guards against.
	console.error(
		'✖ node manifest regeneration failed. Fix it, or run `npm run buildonly` to build without it.'
	);
	process.exit(1);
}
