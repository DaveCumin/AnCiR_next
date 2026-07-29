// Guards the citation metadata against drifting from appConsts.version.
//
// appConsts.version in core.svelte.js is the single hand-edited source of truth.
// `node src/lib/utils/generateBuild.js` (run first by `pnpm build`) propagates it
// into package.json and CITATION.cff. If the version is bumped and committed
// without a build, the DOI record minted from the next tag would carry a version
// that disagrees with the running app. This test runs in the normal `pnpm test`
// path so that drift fails CI. To fix a failure: run `pnpm build` (or just
// `node src/lib/utils/generateBuild.js`).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { appConsts } from '../core/core.svelte.js';

// The display form carries a prefix ("β.70.4"); the citation files carry the
// plain, tag-matching form ("70.4").
const plain = appConsts.version.replace(/^[^0-9]*/, '');

describe('citation metadata matches appConsts.version', () => {
	it('appConsts.version reduces to a numeric version', () => {
		expect(plain).toMatch(/^\d+(\.\d+)*$/);
	});

	it('package.json version is in sync (run `pnpm build` to fix)', () => {
		const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
		expect(pkg.version).toBe(plain);
	});

	it('CITATION.cff version is in sync (run `pnpm build` to fix)', () => {
		const cff = readFileSync('./CITATION.cff', 'utf8');
		const match = cff.match(/^version:\s*"?([^"\n]+)"?\s*$/m);
		expect(match, 'no top-level version: key in CITATION.cff').not.toBeNull();
		expect(match[1]).toBe(plain);
	});

	it('CITATION.cff and .zenodo.json agree on the creator list', () => {
		const cff = readFileSync('./CITATION.cff', 'utf8');
		const zenodo = JSON.parse(readFileSync('./.zenodo.json', 'utf8'));
		const cffFamilies = [...cff.matchAll(/^ {2}- family-names:\s*(.+)$/gm)].map((m) =>
			m[1].trim()
		);
		const zenodoFamilies = zenodo.creators.map((c) => c.name.split(',')[0].trim());
		expect(zenodoFamilies).toEqual(cffFamilies);
	});
});
