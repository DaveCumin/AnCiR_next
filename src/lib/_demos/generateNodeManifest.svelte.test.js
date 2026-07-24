/**
 * Writes static/nodes.json — a machine-readable manifest of EVERY AnCiR node
 * (table-processes, column-processes, plots), derived from the live registry so
 * it never drifts from the app. The build regenerates it (`pnpm manifest:gen`),
 * and nodeManifestFreshness.svelte.test.js fails CI if the committed file is
 * stale. The handbook (a workspace member) imports it directly for its Node
 * Reference page, overlaying curated descriptions/maths/references.
 *
 * The build logic lives in buildNodeManifest.js so this writer and the freshness
 * test are guaranteed identical. Gated by GEN_MANIFEST so it never writes in the
 * normal suite:
 *   GEN_MANIFEST=1 npx vitest run src/lib/_demos/generateNodeManifest.svelte.test.js
 */
import { describe, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { buildNodeManifest, MANIFEST_PATH } from './buildNodeManifest.js';

describe.runIf(process.env.GEN_MANIFEST)('generate node manifest', () => {
	it('writes static/nodes.json from the live registry', { timeout: 120000 }, async () => {
		const manifest = await buildNodeManifest();
		writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
		// eslint-disable-next-line no-console
		console.log(`wrote ${manifest.count} nodes to static/nodes.json`);
	});
});
