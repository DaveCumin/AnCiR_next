/**
 * A legend line swatch must carry a VALID stroke-dasharray, or none.
 *
 * `LineClass.stroke` holds a stroke STYLE: the literal 'solid' plus three real
 * dash patterns (strokeStyles.js). Line.svelte knows that and maps 'solid' to
 * no dasharray at all. The legend passed the field straight through, so every
 * solid-line swatch rendered `stroke-dasharray="solid"`, which is not a valid
 * value for that attribute.
 *
 * It was invisible on screen: a browser ignores an invalid dasharray and draws
 * a solid line, which is what was wanted anyway. It was NOT invisible in the
 * artefact the user keeps — a saved SVG carried the bad attribute out to
 * whatever opens it next, and that was confirmed in a real export before this
 * test was written. Five plots gained a legend at once, which is what made an
 * eleven-plot-wide cosmetic sloppiness worth closing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import Legend, { LegendClass } from './Legend.svelte';
import { STROKE_STYLES } from './strokeStyles.js';

afterEach(() => cleanup());

function lineSwatches(items) {
	const { container } = render(Legend, {
		props: {
			which: 'plot',
			legendData: new LegendClass({ show: true }),
			items,
			plotWidth: 400,
			plotHeight: 300,
			padding: { top: 10, right: 10, bottom: 10, left: 10 }
		}
	});
	// The swatch lines only; the box is a <rect>.
	return [...container.querySelectorAll('line')];
}

const item = (stroke) => ({
	label: 'series',
	elements: [{ type: 'line', color: '#234154', strokeWidth: 2, stroke }]
});

describe('legend line swatch dash pattern', () => {
	it('emits NO dasharray attribute for a solid line', () => {
		const [line] = lineSwatches([item('solid')]);
		expect(line).toBeTruthy();
		expect(line.getAttribute('stroke-dasharray')).toBeNull();
	});

	it('emits the real pattern for every dashed style the UI offers', () => {
		const dashed = STROKE_STYLES.filter((s) => s !== 'solid');
		expect(dashed.length).toBeGreaterThan(0);
		const lines = lineSwatches(dashed.map(item));
		expect(lines).toHaveLength(dashed.length);
		lines.forEach((line, i) => {
			expect(line.getAttribute('stroke-dasharray')).toBe(dashed[i]);
		});
	});

	it('never writes a stroke-dasharray that is not a number list', () => {
		// The general rule, so a future stroke style that is a NAME rather than a
		// pattern cannot reintroduce this by passing the two cases above.
		for (const style of STROKE_STYLES) {
			const [line] = lineSwatches([item(style)]);
			const dash = line.getAttribute('stroke-dasharray');
			if (dash === null) continue;
			expect(dash, `${style} produced a non-numeric dasharray`).toMatch(/^[\d.,\s]+$/);
			cleanup();
		}
	});

	it('tolerates a missing stroke (an element that never set one)', () => {
		const [line] = lineSwatches([
			{ label: 'threshold', elements: [{ type: 'line', color: '#000', strokeWidth: 1 }] }
		]);
		expect(line.getAttribute('stroke-dasharray')).toBeNull();
	});
});
