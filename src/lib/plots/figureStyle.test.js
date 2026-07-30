import { describe, it, expect } from 'vitest';
import {
	FIGURE_STYLE_FIELDS,
	FIGURE_STYLE_KEYS,
	BASE_PT,
	ROLE_RATIOS,
	WIDTH_PRESET_MM,
	FONT_STACKS,
	PX_PER_MM,
	PX_PER_PT,
	newFigureStyle,
	normaliseFigureStyle,
	transitionalFigureStyle,
	applyStyleToAll,
	basePt,
	widthMm,
	resolveStyle,
	exportScale
} from './figureStyle.js';

// THE RATCHET.
//
// The global style is a TEMPLATE copied into new plots; existing plots change only
// on "Apply to all". That model's known weakness is that a newly added field must
// join the copy logic or it silently never applies. These tests fail when the
// registry and the functions drift, which is the whole reason the registry exists.
describe('registry drives everything', () => {
	it('newFigureStyle emits exactly the registered keys', () => {
		expect(Object.keys(newFigureStyle()).sort()).toEqual([...FIGURE_STYLE_KEYS].sort());
	});

	it('every registered key has its declared default', () => {
		const style = newFigureStyle();
		for (const field of FIGURE_STYLE_FIELDS) {
			expect(style[field.key]).toEqual(field.default);
		}
	});

	it('applyStyleToAll writes every registered key', () => {
		// The failure this guards: a field is added to the registry, new plots get it,
		// but "Apply to all" leaves existing plots without it.
		const template = newFigureStyle();
		for (const field of FIGURE_STYLE_FIELDS) {
			if (field.values) template[field.key] = field.values[field.values.length - 1];
			else if (field.type === 'boolean') template[field.key] = !field.default;
			else if (field.type === 'number') template[field.key] = 42;
			else if (field.type === 'string') template[field.key] = 'sentinel';
			else if (field.type === 'object') template[field.key] = { tick: 0.5 };
		}
		const plots = [{ style: newFigureStyle() }, { style: newFigureStyle() }];
		expect(applyStyleToAll(plots, template)).toBe(2);
		for (const plot of plots) {
			for (const key of FIGURE_STYLE_KEYS) {
				expect(plot.style[key]).toEqual(template[key]);
			}
		}
	});

	it('every enum field declares its default as a legal value', () => {
		for (const field of FIGURE_STYLE_FIELDS) {
			if (field.values) expect(field.values).toContain(field.default);
		}
	});

	it('ROLE_RATIOS covers every role resolveStyle emits', () => {
		expect(Object.keys(resolveStyle(newFigureStyle()).sizes).sort()).toEqual(
			Object.keys(ROLE_RATIOS).sort()
		);
	});
});

describe('newFigureStyle', () => {
	it('copies valid template values', () => {
		const style = newFigureStyle({ fontFamily: 'serif', exportDpi: 600 });
		expect(style.fontFamily).toBe('serif');
		expect(style.exportDpi).toBe(600);
	});

	it('rejects an out-of-enum template value', () => {
		expect(newFigureStyle({ fontFamily: 'comic' }).fontFamily).toBe('sans');
	});

	it('rejects a wrong-typed template value', () => {
		expect(newFigureStyle({ exportDpi: '600' }).exportDpi).toBe(300);
		expect(newFigureStyle({ legendBox: 'yes' }).legendBox).toBe(true);
	});

	it('preserves an explicit null on a nullable field', () => {
		// null means "not overridden" for these, so it must survive rather than being
		// swapped for the default (which is also null, but would mask a real bug if
		// the default ever changed).
		expect(newFigureStyle({ fontSizePt: null }).fontSizePt).toBeNull();
		expect(newFigureStyle({ roleScale: null }).roleScale).toBeNull();
	});

	it('does not alias the template (a later edit must not leak)', () => {
		const template = newFigureStyle();
		const style = newFigureStyle(template);
		style.fontFamily = 'serif';
		expect(template.fontFamily).toBe('sans');
	});

	it('does not share the plot style object between plots', () => {
		const plots = [{}, {}];
		applyStyleToAll(plots, newFigureStyle());
		plots[0].style.fontFamily = 'serif';
		expect(plots[1].style.fontFamily).toBe('sans');
	});
});

describe('normaliseFigureStyle', () => {
	it('returns defaults for junk', () => {
		for (const junk of [null, undefined, 'nope', 7, [], true]) {
			expect(normaliseFigureStyle(junk)).toEqual(newFigureStyle());
		}
	});

	it('fills fields missing from an older session', () => {
		// A session saved before a field existed must load, not throw or go undefined.
		const style = normaliseFigureStyle({ fontFamily: 'serif' });
		expect(style.fontFamily).toBe('serif');
		expect(style.legendBox).toBe(true);
		expect(Object.keys(style).sort()).toEqual([...FIGURE_STYLE_KEYS].sort());
	});

	it('drops unknown keys', () => {
		const style = normaliseFigureStyle({ fontFamily: 'serif', somethingElse: 1 });
		expect(style).not.toHaveProperty('somethingElse');
	});
});

describe('applyStyleToAll', () => {
	it('mutates the existing style object rather than replacing it', () => {
		// A $state-backed style must keep its identity or reactive readers stop
		// updating; replacing the object silently breaks that.
		const plot = { style: newFigureStyle() };
		const before = plot.style;
		applyStyleToAll([plot], newFigureStyle({ fontFamily: 'serif' }));
		expect(plot.style).toBe(before);
		expect(plot.style.fontFamily).toBe('serif');
	});

	it('gives a plot with no style one', () => {
		const plot = {};
		applyStyleToAll([plot], newFigureStyle({ fontFamily: 'serif' }));
		expect(plot.style.fontFamily).toBe('serif');
	});

	it('skips junk entries without throwing', () => {
		expect(applyStyleToAll([null, undefined, 'x', { style: newFigureStyle() }], {})).toBe(1);
	});

	it('tolerates a non-array', () => {
		expect(applyStyleToAll(null, {})).toBe(0);
	});
});

describe('basePt', () => {
	it('maps the named steps', () => {
		expect(basePt({ fontSize: 's' })).toBe(BASE_PT.s);
		expect(basePt({ fontSize: 'm' })).toBe(BASE_PT.m);
		expect(basePt({ fontSize: 'l' })).toBe(BASE_PT.l);
	});

	it('uses fontSizePt when custom', () => {
		expect(basePt({ fontSize: 'custom', fontSizePt: 12 })).toBe(12);
	});

	it('falls back when custom has no number yet', () => {
		// Picking "custom" before typing must not produce NaN sizes downstream.
		expect(basePt({ fontSize: 'custom', fontSizePt: null })).toBe(BASE_PT.m);
		expect(basePt({ fontSize: 'custom', fontSizePt: NaN })).toBe(BASE_PT.m);
	});

	it('clamps a nonsensical custom size', () => {
		expect(basePt({ fontSize: 'custom', fontSizePt: 0 })).toBeGreaterThan(0);
		expect(basePt({ fontSize: 'custom', fontSizePt: -5 })).toBeGreaterThan(0);
	});

	it('falls back for a missing or unknown step', () => {
		expect(basePt(undefined)).toBe(BASE_PT.m);
		expect(basePt({ fontSize: 'xl' })).toBe(BASE_PT.m);
	});
});

describe('widthMm', () => {
	it('maps the presets', () => {
		expect(widthMm({ widthPreset: 'single' })).toBe(WIDTH_PRESET_MM.single);
		expect(widthMm({ widthPreset: 'double' })).toBe(WIDTH_PRESET_MM.double);
	});

	it('uses widthMm when custom', () => {
		expect(widthMm({ widthPreset: 'custom', widthMm: 120 })).toBe(120);
	});

	it('falls back when custom has no number', () => {
		expect(widthMm({ widthPreset: 'custom', widthMm: null })).toBe(WIDTH_PRESET_MM.single);
	});

	it('clamps a nonsensical custom width', () => {
		expect(widthMm({ widthPreset: 'custom', widthMm: 0 })).toBeGreaterThan(0);
	});
});

describe('resolveStyle', () => {
	it('converts points to pixels at 96 dpi', () => {
		const { sizes } = resolveStyle(newFigureStyle({ fontSize: 'm' }));
		// axisLabel is the base (ratio 1), so it is exactly base pt in px.
		expect(sizes.axisLabel).toBeCloseTo(BASE_PT.m * PX_PER_PT, 6);
	});

	it('a known case comes out right', () => {
		// 8.5 pt = 8.5 * 4/3 px = 11.333 px; 85 mm = 85 * 96/25.4 = 321.26 px.
		const r = resolveStyle(newFigureStyle());
		expect(r.sizes.axisLabel).toBeCloseTo(11.3333, 3);
		expect(r.widthPx).toBeCloseTo(321.26, 1);
	});

	it('applies role ratios', () => {
		const { sizes } = resolveStyle(newFigureStyle());
		expect(sizes.tick).toBeLessThan(sizes.axisLabel);
		expect(sizes.annotation).toBeLessThan(sizes.tick);
		expect(sizes.legend).toBeCloseTo(sizes.axisLabel, 6);
	});

	it('scales every role together when the base changes', () => {
		const small = resolveStyle(newFigureStyle({ fontSize: 's' })).sizes;
		const large = resolveStyle(newFigureStyle({ fontSize: 'l' })).sizes;
		for (const role of Object.keys(ROLE_RATIOS)) {
			expect(large[role]).toBeGreaterThan(small[role]);
		}
	});

	it('honours a per-role override', () => {
		const base = resolveStyle(newFigureStyle()).sizes;
		const tweaked = resolveStyle(newFigureStyle({ roleScale: { tick: 0.5 } })).sizes;
		expect(tweaked.tick).toBeLessThan(base.tick);
		// and leaves the other roles alone
		expect(tweaked.axisLabel).toBeCloseTo(base.axisLabel, 6);
	});

	it('ignores a junk per-role override', () => {
		const base = resolveStyle(newFigureStyle()).sizes;
		const junk = resolveStyle(newFigureStyle({ roleScale: { tick: 'small' } })).sizes;
		expect(junk.tick).toBeCloseTo(base.tick, 6);
	});

	it('returns a real font stack for each family', () => {
		expect(resolveStyle({ fontFamily: 'serif' }).fontFamily).toBe(FONT_STACKS.serif);
		expect(resolveStyle({ fontFamily: 'sans' }).fontFamily).toBe(FONT_STACKS.sans);
		expect(resolveStyle({}).fontFamily).toBe(FONT_STACKS.sans);
	});

	it('never emits a non-finite or non-positive size', () => {
		// Components divide by and lay out from these numbers, so a NaN here becomes an
		// invisible or broken axis rather than an obvious error.
		const hostile = [
			null,
			undefined,
			{},
			{ fontSize: 'custom', fontSizePt: NaN },
			{ fontSize: 'custom', fontSizePt: -1 },
			{ fontSize: 'custom', fontSizePt: 0 },
			{ roleScale: { tick: 0 } },
			{ roleScale: { tick: -3 } },
			{ roleScale: 'nope' },
			{ widthPreset: 'custom', widthMm: -10 }
		];
		for (const style of hostile) {
			const r = resolveStyle(style);
			expect(Number.isFinite(r.widthPx)).toBe(true);
			expect(r.widthPx).toBeGreaterThan(0);
			for (const [role, px] of Object.entries(r.sizes)) {
				expect(Number.isFinite(px), `${role} for ${JSON.stringify(style)}`).toBe(true);
				expect(px, `${role} for ${JSON.stringify(style)}`).toBeGreaterThan(0);
			}
		}
	});

	it('is pure (does not mutate the style)', () => {
		const style = newFigureStyle();
		const snapshot = JSON.stringify(style);
		resolveStyle(style);
		expect(JSON.stringify(style)).toBe(snapshot);
	});
});

describe('unit constants', () => {
	it('PX_PER_MM and PX_PER_PT are the CSS reference conversions', () => {
		expect(PX_PER_MM).toBeCloseTo(3.779527, 5);
		expect(PX_PER_PT).toBeCloseTo(1.333333, 5);
	});
});

describe('exportScale', () => {
	it('300 dpi is a 3.125x raster', () => {
		expect(exportScale({ exportDpi: 300 })).toBeCloseTo(300 / 96, 6);
	});

	it('96 dpi is 1:1', () => {
		expect(exportScale({ exportDpi: 96 })).toBe(1);
	});

	it('falls back to 1 for junk rather than collapsing the canvas', () => {
		// A zero or negative scale would produce a zero-sized canvas, i.e. an empty
		// exported image, which is worse than exporting at screen resolution.
		for (const dpi of [0, -300, NaN, '300', null, undefined]) {
			expect(exportScale({ exportDpi: dpi })).toBe(1);
		}
	});
});

// The transitional default exists to keep every existing figure looking the same
// when Axis started reading this module. The exact pixel values are the contract.
describe('transitionalFigureStyle', () => {
	it('reproduces the historical 16px axis label and 15px tick', () => {
		// These were hardcoded in Axis.svelte as labelfontsize = 16, tickfontsize = 15.
		// If this drifts, every figure in every saved session changes size on load.
		const { sizes } = resolveStyle(transitionalFigureStyle());
		expect(sizes.axisLabel).toBeCloseTo(16, 6);
		expect(sizes.tick).toBeCloseTo(15, 6);
	});

	it('is a complete, valid style like any other', () => {
		expect(Object.keys(transitionalFigureStyle()).sort()).toEqual([...FIGURE_STYLE_KEYS].sort());
	});

	it('leaves everything except type size at the registry default', () => {
		// It is a TYPE SIZE stopgap only. If it started overriding width or DPI it
		// would quietly hold back the rest of the feature.
		const t = transitionalFigureStyle();
		const d = newFigureStyle();
		for (const key of FIGURE_STYLE_KEYS) {
			if (key === 'fontSize' || key === 'fontSizePt' || key === 'roleScale') continue;
			expect(t[key], key).toEqual(d[key]);
		}
	});

	it('differs from the journal step, which is the whole reason it exists', () => {
		expect(resolveStyle(transitionalFigureStyle()).sizes.axisLabel).toBeGreaterThan(
			resolveStyle(newFigureStyle({ fontSize: 'm' })).sizes.axisLabel
		);
	});
});

describe('resolveStyle pass-through flags', () => {
	it('surfaces legendBox and backgroundColour', () => {
		const r = resolveStyle(newFigureStyle({ legendBox: false, backgroundColour: '#ffffff' }));
		expect(r.legendBox).toBe(false);
		expect(r.backgroundColour).toBe('#ffffff');
	});

	it('defaults them for a partial style, so a component never sees undefined', () => {
		const r = resolveStyle(null);
		expect(r.legendBox).toBe(true);
		expect(r.backgroundColour).toBe('transparent');
	});
});
