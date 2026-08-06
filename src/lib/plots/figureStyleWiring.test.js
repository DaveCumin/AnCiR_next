// Every rendered Axis and Legend must be handed the figure style.
//
// WHY THIS GUARD EXISTS
//
// The style reaches Axis and Legend as a PROP, from 19 call sites across 9 plot
// components. Context was tried first and is wrong here: Axis is rendered from
// four different host components (core/Plot.svelte, PlotDisplay, EmbeddedPlot
// twice), and a facet child carries its OWN style, so "nearest ancestor" is not
// the same thing as "the figure this axis belongs to". The first attempt silently
// fell back to defaults on every canvas plot, which looked like working code and
// was only caught by reading the rendered font size out of the DOM.
//
// A prop is correct but hand-wired per site, so the failure mode is that a NEW
// plot type renders an axis without the prop and quietly gets default typography
// while every other plot follows the figure. Nothing else would notice. This test
// is what notices.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PLOTS_DIR = HERE;

function svelteFiles(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) svelteFiles(full, out);
		else if (entry.endsWith('.svelte')) out.push(full);
	}
	return out;
}

/**
 * Every <Axis …/> or <Legend …/> tag in a source file.
 *
 * Scans from each tag start to the next `/>` rather than matching `[^>]*?/>`.
 * That distinction is the reason this helper exists: the naive character class
 * stops at the `>` inside an arrow function, and three bottom axes carry
 * `tickFormat={(d) => …}`. The first version of both the wiring script AND this
 * guard used the naive pattern, so the guard passed while those three axes were
 * silently unstyled. A guard that shares a blind spot with the code it checks is
 * worse than no guard, because it reports success.
 *
 * `/>` is a safe terminator: arrow functions are `=>`, never `/>`.
 */
function renderTags(src) {
	const tags = [];
	const starts = [...src.matchAll(/<(?:Axis|Legend)\b/g)];
	for (const m of starts) {
		const end = src.indexOf('/>', m.index);
		if (end === -1) continue;
		tags.push(src.slice(m.index, end + 2));
	}
	return tags;
}

/**
 * Tags that draw into the plot, i.e. not the `which="controls"` variants, which
 * render form inputs and no figure text.
 */
function plotTags(src) {
	return renderTags(src).filter((t) => !t.includes('which="controls"'));
}

const files = svelteFiles(PLOTS_DIR);

describe('figure style is wired to every plotbit that draws text', () => {
	it('finds the plot components (guards against the glob silently matching nothing)', () => {
		// Without this, deleting or moving the plots would make every assertion below
		// pass vacuously.
		const withTags = files.filter((f) => plotTags(readFileSync(f, 'utf8')).length > 0);
		expect(withTags.length).toBeGreaterThanOrEqual(9);
	});

	it('finds every tag, including ones containing an arrow function', () => {
		// The specific miss this suite exists to prevent. Three bottom axes carry
		// `tickFormat={(d) => …}`; a `[^>]*?/>` matcher stops at the `>` in `=>` and
		// never sees them, which is how they shipped unstyled while this file was green.
		const total = files.reduce((n, f) => n + plotTags(readFileSync(f, 'utf8')).length, 0);
		expect(total).toBeGreaterThanOrEqual(22);
		const withArrow = files
			.flatMap((f) => plotTags(readFileSync(f, 'utf8')))
			.filter((t) => t.includes('=>'));
		expect(withArrow.length).toBeGreaterThanOrEqual(3);
	});

	for (const file of files) {
		const src = readFileSync(file, 'utf8');
		const tags = plotTags(src);
		if (tags.length === 0) continue;
		const rel = relative(PLOTS_DIR, file);

		it(`${rel} passes figureStyle to all ${tags.length} plot-branch tag(s)`, () => {
			const missing = tags
				.filter((t) => !/figureStyle=\{/.test(t))
				.map((t) => t.replace(/\s+/g, ' ').slice(0, 80));
			expect(missing, `add figureStyle={…parentBox?.style} in ${rel}`).toEqual([]);
		});

		it(`${rel} resolves figureStyle off the wrapper plot`, () => {
			// The style lives on the WRAPPER (core/Plot.svelte's Plot class), reachable as
			// parentBox from any inner plot class. Reading it from anywhere else (say the
			// inner class directly) would silently be undefined and fall back to defaults.
			//
			// `viewStyle` is also allowed: a plot that lays out to a view-local box (see
			// Scatterplot's renderBox) passes the figure style PLUS a font multiplier. It is
			// still the figure's style, so the guard's purpose holds — but only if that derived
			// really is built from parentBox.style, which the next assertion checks rather than
			// taking on trust. Widening this without that check would be a hole, since any
			// `somethingStyle` would then pass.
			for (const tag of tags) {
				const m = /figureStyle=\{([^}]+)\}/.exec(tag);
				expect(m, `figureStyle missing in ${rel}`).toBeTruthy();
				expect(m[1], `${rel}: ${m[1]}`).toMatch(/(parentBox\?*\.style|\.viewStyle)$/);
			}
		});

		it(`${rel} defines any viewStyle in terms of the figure's own style`, () => {
			// Only meaningful for a file that uses viewStyle; a no-op elsewhere.
			if (!tags.some((t) => /figureStyle=\{[^}]*\.viewStyle\}/.test(t))) return;
			const decl = /viewStyle\s*=\s*\$derived\(([\s\S]*?)\n\t\t\);/.exec(src);
			expect(decl, `${rel}: viewStyle is passed but not declared as a $derived`).toBeTruthy();
			expect(decl[1], `${rel}: viewStyle must derive from parentBox?.style`).toMatch(
				/parentBox\?*\.style/
			);
		});
	}
});

describe('Axis and Legend accept the prop and tolerate its absence', () => {
	const axis = readFileSync(join(HERE, '..', 'components', 'plotbits', 'Axis.svelte'), 'utf8');
	const legend = readFileSync(join(HERE, '..', 'components', 'plotbits', 'Legend.svelte'), 'utf8');

	it('both declare figureStyle as a prop defaulting to null', () => {
		expect(axis).toMatch(/figureStyle = null/);
		expect(legend).toMatch(/figureStyle = null/);
	});

	it('neither reads the style from context', () => {
		// Context was the first attempt and was wrong; this stops it coming back.
		expect(axis).not.toMatch(/getContext\(/);
		expect(legend).not.toMatch(/getContext\(FIGURE/);
	});

	it('Axis no longer hardcodes a font size or family', () => {
		expect(axis).not.toMatch(/tickfontsize = \d/);
		expect(axis).not.toMatch(/labelfontsize = \d/);
		expect(axis).not.toMatch(/'system-ui, sans-serif'/);
	});

	it('Legend measures its text in the figure family, not a hardcoded one', () => {
		// Sizing the box from widths measured in the wrong family makes the border not
		// fit the text it encloses, which only shows once a figure is set to serif.
		expect(legend).not.toMatch(/px sans-serif`/);
		expect(legend).toMatch(/px \$\{resolved\.fontFamily\}`/);
	});
});
