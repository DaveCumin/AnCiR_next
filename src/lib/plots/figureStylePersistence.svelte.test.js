// Figure style survives a save/load round trip.
//
// Export needs no dedicated code: outputCoreAsJson stringifies `core` wholesale, so
// anything added to core is serialised automatically. That is exactly why this test
// exists on the EXPORT side too: the mechanism is implicit, so a future refactor
// that switches to an explicit field list would drop figureStyle silently, and
// nothing else would notice until someone's typography failed to reload.
//
// The import side is explicit (Setting.svelte importJson calls
// normaliseFigureStyle), and the cases that matter are old sessions with the key
// missing and hand-edited sessions with the key wrong.
import { describe, it, expect, beforeEach } from 'vitest';
import { core, outputCoreAsJson } from '$lib/core/core.svelte';
import { newFigureStyle, normaliseFigureStyle, FIGURE_STYLE_KEYS } from './figureStyle.js';

/**
 * The saved session, parsed.
 *
 * `outputCoreAsJson` returns a JSON STRING despite the name, so parsing here is
 * what a real save/load does anyway: it exercises the serialisation rather than
 * inspecting live objects.
 */
const savedSession = () => JSON.parse(outputCoreAsJson());

describe('core.figureStyle', () => {
	beforeEach(() => {
		core.figureStyle = newFigureStyle();
	});

	it('exists on a fresh core with every registered field', () => {
		expect(Object.keys(core.figureStyle).sort()).toEqual([...FIGURE_STYLE_KEYS].sort());
	});

	it('is included in the exported session JSON', () => {
		core.figureStyle.fontFamily = 'serif';
		core.figureStyle.widthPreset = 'double';
		const out = savedSession();
		expect(out.figureStyle).toBeDefined();
		expect(out.figureStyle.fontFamily).toBe('serif');
		expect(out.figureStyle.widthPreset).toBe('double');
	});

	it('round-trips every field through export and normalise', () => {
		core.figureStyle = newFigureStyle({
			fontFamily: 'serif',
			fontSize: 'custom',
			fontSizePt: 9.5,
			widthPreset: 'custom',
			widthMm: 120,
			exportDpi: 600,
			palette: 'devon',
			monochrome: true,
			varyMarkers: true,
			backgroundColour: '#ffffff',
			legendBox: false,
			roleScale: { tick: 0.75 }
		});
		const restored = normaliseFigureStyle(savedSession().figureStyle);
		expect(restored).toEqual(core.figureStyle);
	});

	it('a session saved before figureStyle existed loads with defaults', () => {
		expect(normaliseFigureStyle(undefined)).toEqual(newFigureStyle());
	});

	it('a session with a partially written style keeps the good fields', () => {
		const restored = normaliseFigureStyle({ fontFamily: 'serif', exportDpi: 'lots' });
		expect(restored.fontFamily).toBe('serif');
		expect(restored.exportDpi).toBe(300);
	});

	it('serialises as a flat object of primitives, so a plot class is never needed', () => {
		// Keeping the style plain data is what lets normaliseFigureStyle validate it
		// field by field on load. If it ever grew a class with a toJSON, the registry
		// checks would silently stop covering the real shape.
		core.figureStyle.roleScale = { tick: 0.75 };
		const out = savedSession().figureStyle;
		expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
		for (const [key, value] of Object.entries(out)) {
			if (value === null || key === 'roleScale') continue;
			expect(typeof value, key).not.toBe('object');
		}
	});
});
