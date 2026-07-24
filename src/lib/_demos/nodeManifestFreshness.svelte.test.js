// Guards static/nodes.json against drifting from the live AnCiR registry.
//
// nodes.json is produced by `pnpm manifest:gen` (and by the build) from the live
// registry, stamped with appConsts.version. If a node is added/renamed/retuned,
// or the version is bumped, without regenerating, the handbook's Node Reference
// shows stale data. This test runs in the normal `pnpm test` path so any such
// staleness fails CI. To fix a failure: run `pnpm manifest:gen` (or `pnpm build`).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildNodeManifest, MANIFEST_PATH } from './buildNodeManifest.js';

describe('static/nodes.json is fresh vs the live registry', () => {
	it(
		'matches what the current registry + version would generate (run `pnpm manifest:gen` to fix)',
		{ timeout: 120000 },
		async () => {
			const committed = readFileSync(MANIFEST_PATH, 'utf8');
			// Serialize exactly as the generator writes it, so the comparison is
			// byte-exact and immune to JSON round-trip lossiness (undefined / NaN
			// defaults). Catches a version bump, nodes added/removed, and any change
			// to a node's params / description / ports / demo link.
			const regenerated = JSON.stringify(await buildNodeManifest(), null, 2) + '\n';
			expect(regenerated).toBe(committed);
		}
	);
});
