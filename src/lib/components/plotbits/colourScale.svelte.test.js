/**
 * The colour-scale legend: the colour-mapped plots' answer to a series legend.
 *
 * Scatterplot-style plots list their series as swatches. CWT and the correlation
 * heatmap have no series to list: their key is a continuous ramp, so their legend
 * is a gradient bar with the numbers its ends stand for.
 *
 * The two things that can go wrong here are both silent on screen:
 *
 *   - the gradient is drawn from a DIFFERENT ramp than the field it explains, so
 *     the key lies about the picture beside it, and
 *   - the tick numbers are invented (the CWT bar used to be labelled "0" and
 *     "max", which is a shape, not a measurement) rather than read from the
 *     domain the plot actually normalises against.
 *
 * Both are asserted against `colormapRGB` and against the domain directly, so a
 * ramp or domain change cannot drift away from the key unnoticed.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import ColourScale, {
	ColourScaleClass,
	gradientStops,
	scaleTickValues,
	formatScaleValue,
	fitBarTicks,
	fitScaleTitle,
	minBarLength,
	TICK_LABEL_SPACE
} from './ColourScale.svelte';
import { LegendClass } from './Legend.svelte';
import { colormapRGB } from '$lib/components/plotbits/colormaps.js';

afterEach(() => cleanup());

function draw(props = {}) {
	const { container } = render(ColourScale, {
		props: {
			which: 'plot',
			scaleData: new ColourScaleClass({ show: true }),
			colormap: 'viridis',
			domain: [0, 1],
			label: 'Power',
			plotWidth: 400,
			plotHeight: 300,
			padding: { top: 10, right: 70, bottom: 40, left: 60 },
			...props
		}
	});
	return container;
}

const tickTexts = (c) =>
	[...c.querySelectorAll('text.colour-scale-tick')].map((t) => t.textContent);

describe('gradientStops', () => {
	it('samples the colormap it is given, at evenly spaced offsets', () => {
		const stops = gradientStops('viridis', 5);
		expect(stops.map((s) => s.offset)).toEqual([0, 0.25, 0.5, 0.75, 1]);
		expect(stops.map((s) => s.color)).toEqual(
			[0, 0.25, 0.5, 0.75, 1].map((t) => colormapRGB('viridis', t))
		);
	});

	it('follows the colormap ARGUMENT, so the key cannot show a different ramp', () => {
		// The failure this catches: a bar hardcoded to viridis beside a magma field.
		const magma = gradientStops('magma', 5).map((s) => s.color);
		expect(magma).toEqual([0, 0.25, 0.5, 0.75, 1].map((t) => colormapRGB('magma', t)));
		expect(magma).not.toEqual(gradientStops('viridis', 5).map((s) => s.color));
	});

	it('spans the full ramp end to end', () => {
		const stops = gradientStops('rdbu', 11);
		expect(stops[0].color).toBe(colormapRGB('rdbu', 0));
		expect(stops[stops.length - 1].color).toBe(colormapRGB('rdbu', 1));
	});
});

describe('scaleTickValues', () => {
	it('reads the real domain ends and their midpoint', () => {
		expect(scaleTickValues([-1, 1])).toEqual([-1, 0, 1]);
		expect(scaleTickValues([0, 0.5])).toEqual([0, 0.25, 0.5]);
	});

	it('survives a degenerate or non-finite domain without emitting NaN', () => {
		expect(scaleTickValues([2, 2])).toEqual([2, 2, 2]);
		expect(scaleTickValues([NaN, 1]).every(Number.isFinite)).toBe(true);
		expect(scaleTickValues(null).every(Number.isFinite)).toBe(true);
	});
});

describe('formatScaleValue', () => {
	it('prints round numbers roundly and small ones with real precision', () => {
		expect(formatScaleValue(1)).toBe('1');
		expect(formatScaleValue(-1)).toBe('-1');
		expect(formatScaleValue(0)).toBe('0');
		expect(formatScaleValue(0.034521)).toBe('0.0345');
	});

	it('never prints NaN or Infinity into a figure', () => {
		expect(formatScaleValue(NaN)).toBe('');
		expect(formatScaleValue(Infinity)).toBe('');
	});
});

describe('ColourScaleClass', () => {
	it('is a LegendClass, so it speaks the same positioning vocabulary', () => {
		const s = new ColourScaleClass();
		expect(s).toBeInstanceOf(LegendClass);
		expect(s.customX).toBe(0.02);
		expect(s.orientation).toBe('vertical');
	});

	it('defaults to the right margin, where both plots already drew their bar', () => {
		expect(new ColourScaleClass().position).toBe('right');
		expect(new ColourScaleClass({ position: 'topleft' }).position).toBe('topleft');
	});

	it('round-trips every field through toJSON/fromJSON', () => {
		const s = new ColourScaleClass({ show: true });
		s.position = 'bottomleft';
		s.orientation = 'horizontal';
		s.barLength = 88;
		s.barThickness = 14;
		s.fontSize = 9;
		const back = ColourScaleClass.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
		expect(back).toBeInstanceOf(ColourScaleClass);
		expect(back.position).toBe('bottomleft');
		expect(back.orientation).toBe('horizontal');
		expect(back.barLength).toBe(88);
		expect(back.barThickness).toBe(14);
		expect(back.fontSize).toBe(9);
		expect(back.show).toBe(true);
	});

	it('withDefaults returns a ColourScaleClass, not its base class', () => {
		// `LegendClass.withDefaults` used to name its own constructor, so a subclass
		// silently got a plain legend back and lost every field added here.
		const s = ColourScaleClass.withDefaults(null, { show: true });
		expect(s).toBeInstanceOf(ColourScaleClass);
		expect(s.barThickness).toBe(10);
		expect(s.show).toBe(true);
	});

	it('honours an explicit saved choice over the default, in both directions', () => {
		expect(ColourScaleClass.withDefaults({ show: false }, { show: true }).show).toBe(false);
		expect(ColourScaleClass.withDefaults({ show: true }, { show: false }).show).toBe(true);
		// The hole a `{ show, ...json }` spread leaves.
		expect(ColourScaleClass.withDefaults({ show: undefined }, { show: false }).show).toBe(false);
	});
});

describe('ColourScale rendering', () => {
	it('draws nothing at all when it is switched off', () => {
		const c = draw({ scaleData: new ColourScaleClass({ show: false }) });
		expect(c.querySelector('.colour-scale')).toBeNull();
		expect(c.querySelector('linearGradient')).toBeNull();
	});

	it('draws a gradient bar whose stops are the plot’s colormap', () => {
		const c = draw({ colormap: 'magma' });
		const stops = [...c.querySelectorAll('linearGradient stop')];
		expect(stops.length).toBeGreaterThan(2);
		const offsets = stops.map((s) => parseFloat(s.getAttribute('offset')) / 100);
		const colours = stops.map((s) => s.getAttribute('stop-color'));
		expect(colours).toEqual(offsets.map((t) => colormapRGB('magma', t)));
	});

	it('labels the ticks with the plot’s own domain, high end first', () => {
		expect(tickTexts(draw({ domain: [-1, 1] }))).toEqual(['1', '0', '-1']);
		expect(tickTexts(draw({ domain: [0, 0.034521] }))).toEqual(['0.0345', '0.0173', '0']);
	});

	it('shows the measured quantity when one is given, and nothing when not', () => {
		expect(draw({ label: 'Power' }).querySelector('text.colour-scale-label')?.textContent).toBe(
			'Power'
		);
		expect(draw({ label: null }).querySelector('text.colour-scale-label')).toBeNull();
	});

	it('turns a word onto its side but leaves a one-symbol label upright', () => {
		// A rotated 'r' beside a correlation bar reads as a stray mark, not a label.
		// Caught in the browser on the real heatmap demo, not by any assertion above.
		const word = draw({ label: 'Power' }).querySelector('text.colour-scale-label');
		expect(word.getAttribute('transform')).toContain('rotate(-90)');
		const symbol = draw({ label: 'r' }).querySelector('text.colour-scale-label');
		expect(symbol.getAttribute('transform')).toBeNull();
	});

	it('gives each plot its own gradient id, so a combined export cannot cross-wire two', () => {
		const a = draw({ idPrefix: 'cwt-7' }).querySelector('linearGradient').getAttribute('id');
		const b = draw({ idPrefix: 'cwt-9' }).querySelector('linearGradient').getAttribute('id');
		expect(a).not.toBe(b);
		expect(a).toContain('cwt-7');
	});

	it('stays inside the figure when placed in the right margin', () => {
		// The old bars simply vanished when they did not fit. This one is clamped
		// instead, because a key that disappears at some widths is worse than a
		// slightly tighter one.
		const c = draw({ plotWidth: 400, padding: { top: 10, right: 20, bottom: 40, left: 60 } });
		const g = c.querySelector('.colour-scale');
		const [x] = g
			.getAttribute('transform')
			.match(/translate\(([-\d.]+),\s*([-\d.]+)\)/)
			.slice(1)
			.map(Number);
		// left padding + plot width + right padding is the figure's right edge.
		expect(x).toBeLessThanOrEqual(60 + 400 + 20);
	});

	it('the font-size box shows the inherited size and writes an override only on a real edit', async () => {
		// `fontSize` is nullable: null means "follow the figure". Binding that field
		// straight to the number input turned inheriting into a hard override the
		// moment the panel was opened, which is why this goes through a mirror. The
		// mirror is a writable $derived, so the risk is the reverse: an edit being
		// swallowed by the re-derive.
		const scaleData = new ColourScaleClass({ show: true });
		expect(scaleData.fontSize, 'starts out inheriting').toBeNull();
		const { container } = render(ColourScale, { props: { which: 'controls', scaleData } });
		const box = container.querySelector('input[type="number"]');
		// The figure's own legend size, since no override has been made. Not a
		// hardcoded 12: the size comes from the style system.
		expect(Number(box.value), 'shows the size actually drawn').toBeCloseTo(11.3, 1);
		expect(scaleData.fontSize, 'merely rendering the panel writes nothing').toBeNull();

		box.value = '20';
		box.dispatchEvent(new Event('input', { bubbles: true }));
		await Promise.resolve();
		expect(scaleData.fontSize).toBe(20);
	});

	it('offers a control that can switch it on', () => {
		const { container } = render(ColourScale, {
			props: { which: 'controls', scaleData: new ColourScaleClass({ show: false }) }
		});
		expect(container.querySelector('.control-component')).not.toBeNull();
		expect(container.textContent).toContain('Colour scale');
	});
});

// ---- a short bar (v82.45): thinned tick labels, the title kept within the key ------------
//
// On a small plot whose colour bar shares its place with the size key, the automatic bar is
// shortened to fit; at 20 px its 0/6/12/18/24 labels sat on top of one another and its turned
// title ran far past both ends of the bar (and over the legend and the size key).

const HOURS = [0, 6, 12, 18, 24].map((h) => ({ t: h / 24, label: String(h) }));

/** A drawn tick label's extent along the bar, px from the bar's LOW end (as the app
 *  estimates text: 0.6 em per character across, 1 em tall). */
function drawnSpans(c, { vertical, barLen, fontSize }) {
	return [...c.querySelectorAll('text.colour-scale-tick')]
		.map((t) => {
			const label = t.textContent;
			if (vertical) {
				const y = Number(t.getAttribute('y'));
				const base = t.getAttribute('dominant-baseline');
				const top = base === 'hanging' ? y : base === 'central' ? y - fontSize / 2 : y - fontSize;
				return [barLen - top - fontSize, barLen - top];
			}
			const x = Number(t.getAttribute('x'));
			const w = label.length * fontSize * 0.6;
			const anchor = t.getAttribute('text-anchor');
			const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
			return [left, left + w];
		})
		.sort((a, b) => a[0] - b[0]);
}

function expectNoLabelOverlap(spans) {
	for (let i = 1; i < spans.length; i++) {
		expect(spans[i][0] - spans[i - 1][1], JSON.stringify(spans)).toBeGreaterThanOrEqual(
			TICK_LABEL_SPACE
		);
	}
}

describe('fitBarTicks', () => {
	const o = (barLen, vertical = true, fontSize = 12) => ({ vertical, barLen, fontSize });

	it('keeps every tick on a bar long enough for all of them', () => {
		expect(fitBarTicks(HOURS, o(150))).toEqual(HOURS);
	});

	it('hour of day: 0, 12, 24 before dropping to the ends', () => {
		// The end labels sit inside the bar's ends and the others are centred on their ticks, so
		// with 12 px labels and 2 px between: five need the end-to-quarter gap
		// L/4 - 6 - 12 >= 2 (L >= 80); three need L/2 - 6 - 12 >= 2 (L >= 40).
		expect(fitBarTicks(HOURS, o(80)).map((t) => t.label)).toEqual(['0', '6', '12', '18', '24']);
		expect(fitBarTicks(HOURS, o(79)).map((t) => t.label)).toEqual(['0', '12', '24']);
		expect(fitBarTicks(HOURS, o(40)).map((t) => t.label)).toEqual(['0', '12', '24']);
		expect(fitBarTicks(HOURS, o(39)).map((t) => t.label)).toEqual(['0', '24']);
	});

	it('three value ticks drop the middle one; the ends always stay', () => {
		const three = [
			{ t: 0, label: '0' },
			{ t: 0.5, label: '50' },
			{ t: 1, label: '100' }
		];
		expect(fitBarTicks(three, o(40))).toEqual(three);
		expect(fitBarTicks(three, o(39)).map((t) => t.label)).toEqual(['0', '100']);
		// Shorter than the ends need (only a stored length can be): the ends anyway.
		expect(fitBarTicks(three, o(10)).map((t) => t.label)).toEqual(['0', '100']);
	});

	it('a horizontal bar thins by the labels’ widths', () => {
		const wide = [
			{ t: 0, label: '10.5' },
			{ t: 0.5, label: '17.9' },
			{ t: 1, label: '25.3' }
		];
		// Each label 4 x 7.2 = 28.8 px: all three need 2 x 28.8 + 28.8 + 4 = 90.4 px.
		expect(fitBarTicks(wide, o(100, false))).toEqual(wide);
		expect(fitBarTicks(wide, o(80, false)).map((t) => t.label)).toEqual(['10.5', '25.3']);
	});

	it('a single tick is kept', () => {
		expect(fitBarTicks([{ t: 0.5, label: '7' }], o(5))).toEqual([{ t: 0.5, label: '7' }]);
	});
});

describe('fitScaleTitle', () => {
	it('keeps a title that fits, shortens one that does not (with an ellipsis)', () => {
		expect(fitScaleTitle('Hour of day (UTC)', 150, 12)).toBe('Hour of day (UTC)');
		const short = fitScaleTitle('Hour of day (UTC)', 60, 12);
		expect(short.endsWith('…')).toBe(true);
		expect(short.length * 12 * 0.6).toBeLessThanOrEqual(60);
		expect('Hour of day (UTC)'.startsWith(short.slice(0, -1))).toBe(true);
	});

	it('no room for even one letter and the ellipsis: no title', () => {
		expect(fitScaleTitle('Hour of day (UTC)', 10, 12)).toBe('');
	});
});

describe('minBarLength', () => {
	it('is long enough for both end labels, and never under 30 px', () => {
		expect(minBarLength(8)).toBe(30);
		expect(minBarLength(20)).toBe(2 * 20 + TICK_LABEL_SPACE);
		const ends = [
			{ t: 0, label: '0' },
			{ t: 1, label: '24' }
		];
		for (const fs of [6, 11.3, 16, 24])
			expect(fitBarTicks(ends, { vertical: true, barLen: minBarLength(fs), fontSize: fs })).toEqual(
				ends
			);
	});
});

describe.each([
	['vertical', 'vertical'],
	['horizontal', 'horizontal']
])('a %s bar on both sides of the thinning threshold', (_name, orientation) => {
	const vertical = orientation === 'vertical';
	// Not 12: a saved 12 is the legacy default and reads as "follow the figure".
	const fontSize = 13;
	for (const barLen of vertical ? [150, 86, 85, 43, 42, 30] : [250, 100, 60]) {
		it(`${barLen} px: no two tick labels overlap; the title stays within the key`, () => {
			const c = draw({
				scaleData: new ColourScaleClass({ show: true, orientation, fontSize }),
				ticks: HOURS,
				label: 'Hour of day (Pacific/Auckland)',
				length: barLen
			});
			const spans = drawnSpans(c, { vertical, barLen, fontSize });
			expect(spans.length).toBeGreaterThanOrEqual(2);
			expectNoLabelOverlap(spans);
			// Both ends are always labelled.
			const texts = tickTexts(c);
			expect(texts).toContain('0');
			expect(texts).toContain('24');
			// Thinned no further than it must be (13 px type: five labels need 86 px, three 43).
			const want = vertical
				? { 150: 5, 86: 5, 85: 3, 43: 3, 42: 2, 30: 2 }[barLen]
				: { 250: 5, 100: 3, 60: 3 }[barLen];
			expect(texts.length).toBe(want);
			const title = c.querySelector('text.colour-scale-label');
			const shown = title.firstChild?.nodeType === 3 ? title.firstChild.nodeValue : '';
			expect(shown.length * fontSize * 0.6).toBeLessThanOrEqual(barLen);
			if (shown !== 'Hour of day (Pacific/Auckland)') {
				// Shortened: the whole title is the text's tooltip.
				expect(title.querySelector('title')?.textContent).toBe('Hour of day (Pacific/Auckland)');
			} else {
				expect(title.querySelector('title')).toBeNull();
			}
		});
	}
});
