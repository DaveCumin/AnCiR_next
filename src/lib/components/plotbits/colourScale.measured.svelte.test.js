/**
 * The colour scale's text is MEASURED in the figure's family where the browser can.
 *
 * REPORTED (2026-10-22): on the CWT with Rectify off, the raw power "36800" overlapped the
 * turned "Power" title by about 2 px. The bar's geometry estimated every character at 0.6 em,
 * and digits in system-ui are wider (36800 measured 3.16 em, not 3 em); the title sits one em
 * past the estimated width, which leaves only a quarter em once its glyphs' height is taken.
 *
 * jsdom has no canvas, so this file gives it one whose digits are 0.7 em wide (wider than the
 * estimate, as the real fonts' are). In its own file because the measuring context is cached
 * per module (legendLayout.js).
 */
import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import ColourScale, {
	ColourScaleClass,
	colourScaleGeometry,
	categoryKeyGeometry,
	fitScaleTitle,
	tickLabelSpan,
	scaleTextWidth,
	TICK_GAP
} from './ColourScale.svelte';

/** Widths of the fake font, in em: digits 0.7, everything else 0.5. */
const em = (s) => [...String(s)].reduce((w, ch) => w + (/\d/.test(ch) ? 0.7 : 0.5), 0);

beforeAll(() => {
	const real = HTMLCanvasElement.prototype.getContext;
	HTMLCanvasElement.prototype.getContext = function (kind) {
		if (kind !== '2d') return real?.call(this, kind) ?? null;
		const ctx = {
			font: '',
			measureText: (s) => ({ width: em(s) * parseFloat(ctx.font) })
		};
		return ctx;
	};
});
afterEach(() => cleanup());

describe('measured widths', () => {
	it('are measured in the family given, and estimated at 0.6 em without one', () => {
		expect(scaleTextWidth('36800', 12, 'system-ui')).toBeCloseTo(5 * 0.7 * 12, 9);
		expect(scaleTextWidth('36800', 12)).toBeCloseTo(5 * 0.6 * 12, 9);
	});

	it('the bar leaves room for its widest tick label as drawn', () => {
		const g = colourScaleGeometry({
			vertical: true,
			thickness: 10,
			barLen: 150,
			fontSize: 12,
			tickLabels: ['0', '18400', '36800'],
			label: 'Power',
			fontFamily: 'system-ui'
		});
		expect(g.tickTextW).toBeCloseTo(5 * 0.7 * 12, 9);
		expect(g.width).toBeCloseTo(10 + TICK_GAP + 5 * 0.7 * 12 + 12 + 4, 9);
	});

	it('a horizontal bar spaces its tick labels by their drawn widths', () => {
		const o = { vertical: false, barLen: 100, fontSize: 10, fontFamily: 'system-ui' };
		const [a, b] = tickLabelSpan(0.5, '36800', o);
		expect(b - a).toBeCloseTo(5 * 0.7 * 10, 9);
	});

	it('a shortened title fits the room it is given as drawn', () => {
		const t = fitScaleTitle('12345678901234567890', 60, 10, 'system-ui');
		expect(t.endsWith('…')).toBe(true);
		expect(em(t) * 10).toBeLessThanOrEqual(60);
	});

	it('a category key is as wide as its names as drawn', () => {
		const g = categoryKeyGeometry({
			items: [{ label: '12345', colour: 'red' }],
			fontSize: 10,
			fontFamily: 'system-ui'
		});
		expect(g.width).toBeCloseTo(g.swatch + 4 + 5 * 0.7 * 10, 9);
	});
});

describe('the drawn bar', () => {
	it("the turned title clears the widest tick label (CWT's raw power)", () => {
		const { container } = render(ColourScale, {
			props: {
				which: 'plot',
				scaleData: new ColourScaleClass({ show: true }),
				colormap: 'viridis',
				domain: [0, 36800],
				label: 'Power',
				plotWidth: 400,
				plotHeight: 300,
				padding: { top: 10, right: 80, bottom: 40, left: 60 }
			}
		});
		const ticks = [...container.querySelectorAll('text.colour-scale-tick')];
		expect(ticks.map((t) => t.textContent)).toEqual(['36800', '18400', '0']);
		// The size it is drawn at (the figure style's legend size).
		const drawn = Number(ticks[0].getAttribute('font-size'));
		const tickRight = Math.max(
			...ticks.map((t) => Number(t.getAttribute('x')) + em(t.textContent) * drawn)
		);
		const title = container.querySelector('text.colour-scale-label');
		const x = Number(/translate\(([-\d.]+)/.exec(title.getAttribute('transform'))[1]);
		// Turned a quarter, the title's glyphs reach toward the ticks from its baseline by
		// their height (under 0.8 em for capitals in any shipped family).
		expect(x - 0.8 * drawn).toBeGreaterThanOrEqual(tickRight);
	});
});
