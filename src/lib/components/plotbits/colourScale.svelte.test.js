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
	formatScaleValue
} from './ColourScale.svelte';
import { LegendClass } from './Legend.svelte';
import { colormapRGB } from '$lib/plots/Actogram/colormaps.js';

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
