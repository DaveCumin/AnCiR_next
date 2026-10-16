// @ts-nocheck
// Guards that keep plot edits undoable without each control having to remember.
//
// Since 2026-10-17 the plot control panel records every finished gesture as one undo step
// (plots/plotEditScope.js, attached in ControlDisplay). That holds for a write a control makes
// in response to the user's gesture inside the panel. It does NOT hold for:
//
//   1. plot controls rendered somewhere WITHOUT the recorder;
//   2. a floating part of a control moved to <body> that does not name its anchor
//      (components/reusables/editScopePopup.js), since its events never reach the panel;
//   3. a write to plot settings from an `$effect` in a plot's or a plotbit's component: no
//      gesture, so nothing records it (and it would be folded into the next gesture's step);
//   4. the multi-select panel writing a plot setting straight from its markup instead of
//      through its recorded helpers (setSharedField / previewSharedField and their data-row
//      twins, which go through plots/plotEdits.js).
//
// plotControlUndo.registry.svelte.test.js checks the behaviour control by control; these
// greps catch the ways around it that a behavioural test of today's controls cannot see.
// Each allowlist entry carries its reason; a stale entry fails.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, '..', '..'); // src/
const rel = (f) => relative(src, f);

function files(dir, out = []) {
	for (const entry of readdirSync(dir)) {
		if (entry === 'node_modules' || entry.startsWith('.')) continue;
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) files(full, out);
		else if (/\.(svelte|js)$/.test(entry) && !/\.test\.|\.spec\.|conflicted/.test(entry))
			out.push(full);
	}
	return out;
}
const ALL = [...files(join(src, 'lib')), ...files(join(src, 'routes'))];
const read = (f) => readFileSync(f, 'utf8');

describe('1. plot controls only render inside the edit recorder', () => {
	// A plot type's own files render their sub-controls (Axis, Legend, ...) inside their
	// controls snippet, which is itself inside the recorder; only the HOST of a plot's
	// `which="controls"` needs it.
	const isPlotOwnFile = (f) =>
		rel(f).startsWith('lib/plots/') || rel(f).startsWith('lib/components/plotbits/');
	const NOT_RENDERED = {
		'lib/core/Plot.svelte':
			'the Plot module also defines a component that shows a plot and its controls, but no ' +
			'file renders it (only the Plot class is imported); checked below'
	};
	const hosts = ALL.filter(
		(f) =>
			f.endsWith('.svelte') &&
			!isPlotOwnFile(f) &&
			/<\w+[^>]*\btheData=[^>]*which="controls"/s.test(read(f))
	).map(rel);

	it('finds the control panel', () => {
		expect(hosts).toContain('lib/components/views/ControlDisplay.svelte');
	});

	it('every host attaches plotEditScope', () => {
		const missing = hosts.filter(
			(f) => !(f in NOT_RENDERED) && !/plotEditScope\(/.test(read(join(src, f)))
		);
		expect(missing).toEqual([]);
	});

	it("core/Plot.svelte's component is still not rendered anywhere", () => {
		const defaultImports = ALL.filter((f) =>
			/import\s+\w+\s+from\s+['"][^'"]*core\/Plot\.svelte['"]/.test(read(f))
		).map(rel);
		expect(defaultImports).toEqual([]);
		expect(hosts.filter((f) => f in NOT_RENDERED)).toEqual(Object.keys(NOT_RENDERED));
	});
});

describe('2. a control part moved to <body> names its anchor', () => {
	const PORTAL = /document\.body\.(append|appendChild|prepend|insertBefore)\(/;
	// Moved to <body> but never part of a plot control.
	const NOT_PLOT_CONTROLS = {
		'lib/utils/downloadBlob.js': 'a temporary download link',
		'lib/components/plotbits/helpers/save.svelte.js': 'a temporary download link',
		'lib/utils/tooltip.js': 'a tooltip: display only, takes no pointer events',
		'lib/components/plotbits/PlotTooltip.svelte': 'a tooltip: display only',
		'lib/components/workflow/NodeNoteButton.svelte': "a canvas node's note, not a plot setting",
		'lib/tableProcesses/FormulaColumn.svelte': "an analysis node's menu, not a plot control",
		'lib/tableProcesses/BlankColumn.svelte': "an analysis node's menu, not a plot control"
	};
	const portals = ALL.filter((f) => PORTAL.test(read(f))).map(rel);

	it('finds the floating controls (guards a pattern that matches nothing)', () => {
		expect(portals).toContain('lib/components/inputs/ColourPicker.svelte');
	});

	it('each one calls markPopup, or is not a plot control', () => {
		const unmarked = portals.filter(
			(f) => !(f in NOT_PLOT_CONTROLS) && !/markPopup\(/.test(read(join(src, f)))
		);
		expect(unmarked).toEqual([]);
	});

	it('NOT_PLOT_CONTROLS has no stale entry', () => {
		expect(Object.keys(NOT_PLOT_CONTROLS).filter((f) => !portals.includes(f))).toEqual([]);
	});
});

describe('3. no $effect in a plot control writes a plot setting', () => {
	// An assignment to a field of the objects plot controls edit.
	const WRITE =
		/\b(theData|\w+Data|datum|overlay|annotation|marker|band|inner)\.[\w$.[\]?]+\s*(=|\+=|-=)(?![=>])/;
	function effectWrites(text) {
		const out = [];
		for (const m of text.matchAll(/\$effect(\.pre)?\(\s*\(\)\s*=>\s*\{/g)) {
			let i = m.index + m[0].length;
			let depth = 1;
			while (depth > 0 && i < text.length) {
				if (text[i] === '{') depth++;
				else if (text[i] === '}') depth--;
				i++;
			}
			const line = text.slice(0, m.index).split('\n').length;
			for (const l of text.slice(m.index, i).split('\n'))
				if (WRITE.test(l) && !/^\s*(\/\/|\*)/.test(l)) out.push(`${line}: ${l.trim()}`);
		}
		return out;
	}
	const KNOWN = {};

	it('the matcher finds a write (guards a pattern that matches nothing)', () => {
		expect(effectWrites('$effect(() => {\n\tif (x) theData.ylimsIN = [0, 1];\n});')).toHaveLength(
			1
		);
		expect(effectWrites('$effect(() => {\n\tconst v = theData.ylimsIN;\n});')).toHaveLength(0);
	});

	it('finds none in the plots and plotbits', () => {
		const found = {};
		for (const f of ALL) {
			const r = rel(f);
			if (!r.endsWith('.svelte')) continue;
			if (!r.startsWith('lib/plots/') && !r.startsWith('lib/components/plotbits/')) continue;
			const hits = effectWrites(read(f));
			if (hits.length) found[r] = hits;
		}
		expect(found).toEqual(KNOWN);
	});
});

describe('4. the multi-select panel writes through its recorded helpers', () => {
	it('no setByPath and no direct plot write in its markup', () => {
		const text = read(join(src, 'lib/components/views/ControlDisplay.svelte'));
		const markup = text.slice(text.lastIndexOf('</script>'));
		const bad = markup
			.split('\n')
			.map((l, i) => [i, l])
			.filter(([, l]) => /\bon\w+=\{[^}]*(setByPath\(|\.plot\.[\w.[\]]+\s*=[^=])/.test(l))
			.map(([i, l]) => `${i}: ${l.trim()}`);
		expect(bad).toEqual([]);
		expect(markup).toMatch(/previewSharedField\(/);
		expect(markup).toMatch(/setSharedField\(/);
	});
});
