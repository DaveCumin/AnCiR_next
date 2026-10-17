// A node that mirrors its panel state into the compute memo with
//     $effect(() => { if (state !== undefined) memo.payload = state; });
// relies on `state` starting UNDEFINED. That effect runs before onMount, so a fresh
// instance whose state starts as null, [] or {} writes that over the cached result, and
// onMount then "restores" it: the panel comes back empty after every remount and the
// compute effect does not run again (the hash is unchanged). Double Logistic lost its stats
// (and with them its stored-value buttons) that way on every view switch (2026-10-17).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve('src/lib/tableProcesses');

describe('memo mirror state starts undefined', () => {
	const files = fs
		.readdirSync(DIR)
		.filter((f) => f.endsWith('.svelte') && !f.includes('conflicted'))
		.map((f) => ({ f, src: fs.readFileSync(path.join(DIR, f), 'utf8') }));

	const mirrored = files.flatMap(({ f, src }) =>
		[...src.matchAll(/if \((\w+) !== undefined\) memo\.payload = \1;/g)].map((m) => ({
			f,
			src,
			v: m[1]
		}))
	);

	it('finds the mirrored nodes', () => {
		expect(mirrored.length).toBeGreaterThan(15);
	});

	it('every mirrored state is declared `$state()` with no initial value', () => {
		const bad = mirrored
			.filter(({ src, v }) => !new RegExp(`let ${v} = \\$state\\(\\);`).test(src))
			.map(({ f, v }) => `${f}: ${v}`);
		expect(bad).toEqual([]);
	});
});
