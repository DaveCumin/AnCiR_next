// Every checkbox row must be a <label class="control-input-checkbox"> whose text is a
// <span class="ci-label">: the label gives the checkbox its accessible name and makes the
// text clickable. A <div> row with a <p> does neither.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const sources = import.meta.glob('/src/**/*.svelte', { query: '?raw', import: 'default' });

describe('checkbox rows', () => {
	it('are labels, not divs', async () => {
		const offenders = [];
		for (const [path, load] of Object.entries(sources)) {
			if (path.includes('[conflicted]')) continue;
			const src = /** @type {string} */ (await load());
			src.split('\n').forEach((line, i) => {
				if (/<div[^>]*class="[^"]*\bcontrol-input-checkbox\b/.test(line)) {
					offenders.push(`${path}:${i + 1}`);
				}
			});
		}
		expect(offenders).toEqual([]);
	});

	it('the shared stylesheet styles the label text span', () => {
		const page = readFileSync('src/routes/+page.svelte', 'utf8');
		expect(page).toContain(':global(.control-input-checkbox > .ci-label)');
	});
});
