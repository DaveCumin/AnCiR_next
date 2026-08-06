// Every plot that draws to a view-local box must wire it the same way.
//
// This is a source guard rather than a behaviour test because the failure it exists to catch
// is invisible until a plot is rendered in a workflow node: a plot that keeps reading
// `parentBox` still works perfectly in the workspace, and silently ignores the node's size.
//
// It also catches the mistake that actually happened while rolling this out to twelve plots at
// once. A scripted edit inserted the fields and THEN rewrote `this.parentBox.width` →
// `this.viewWidth` everywhere, which rewrote the new fields' own bodies into
// `viewWidth = $derived(this.renderBox?.w ?? this.viewWidth)`. Svelte throws
// `derived_references_self` on that, but only when the plot is constructed — so exactly one
// unit test happened to fail, and eleven broken plots looked fine.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const PLOTS_DIR = dirname(fileURLToPath(import.meta.url));

/** `Foo/Foo.svelte` for every plot directory: the component that owns the plot class. */
const files = readdirSync(PLOTS_DIR, { withFileTypes: true })
	.filter((d) => d.isDirectory())
	.map((d) => ({ name: d.name, path: join(PLOTS_DIR, d.name, `${d.name}.svelte`) }))
	.filter((f) => {
		try {
			readFileSync(f.path);
			return true;
		} catch {
			return false;
		}
	});

describe('view-box wiring', () => {
	it('found the plot components to check', () => {
		expect(files.length).toBeGreaterThanOrEqual(12);
	});

	for (const { name, path } of files) {
		const src = readFileSync(path, 'utf8');
		// Only plots that size their layout from a box are in scope. DataView declares a
		// parentBox but never reads its width or height, so it has nothing to lay out and is
		// legitimately left on the scaled-thumbnail path.
		if (!/this\.(viewWidth|viewHeight|parentBox\.(width|height))/.test(src)) continue;

		it(`${name} declares a renderBox`, () => {
			expect(src, `${name}: add the viewBox.js fields`).toMatch(/renderBox = \$state\(null\);/);
		});

		it(`${name} derives viewWidth/viewHeight from parentBox, not from themselves`, () => {
			const w = /viewWidth\s*=\s*\$derived\(([^;]*)\);/.exec(src);
			const h = /viewHeight\s*=\s*\$derived\(([^;]*)\);/.exec(src);
			expect(w, `${name}: no viewWidth declaration`).toBeTruthy();
			expect(h, `${name}: no viewHeight declaration`).toBeTruthy();
			// The self-reference that Svelte rejects at construction time.
			expect(w[1], `${name}: viewWidth references itself`).not.toMatch(/this\.viewWidth/);
			expect(h[1], `${name}: viewHeight references itself`).not.toMatch(/this\.viewHeight/);
			expect(w[1], `${name}: viewWidth must fall back to parentBox.width`).toMatch(
				/parentBox\.width/
			);
			expect(h[1], `${name}: viewHeight must fall back to parentBox.height`).toMatch(
				/parentBox\.height/
			);
		});

		it(`${name} lays out from the VIEW size, not the figure size`, () => {
			// A plot still measuring `this.parentBox.width` in its layout ignores the node box.
			// `fontScale` legitimately takes the whole parentBox, so only `.width`/`.height`
			// reads count as a miss.
			// The view fields' OWN bodies legitimately fall back to parentBox; strip those two
			// declarations before looking for layout reads, or every plot fails on its own
			// fallback.
			const body = src
				.replace(/viewWidth\s*=\s*\$derived\([^;]*\);/, '')
				.replace(/viewHeight\s*=\s*\$derived\([^;]*\);/, '');
			const strays = [...body.matchAll(/this\.parentBox\.(width|height)/g)].map((m) => m[0]);
			expect(strays, `${name}: ${strays.join(', ')} should read viewWidth/viewHeight`).toEqual(
				[]
			);
		});
	}
});
