/**
 * The correlogram's confidence-bounds dash and the shared dash vocabulary.
 *
 * The bounds line is dashed by default. That default used to be spelled '5,5' while the
 * vocabulary in strokeStyles.js spells it '5, 5', so the Stroke select in the Data panel
 * matched no option and rendered blank on every correlogram, including the shipped demo.
 *
 * Two rules, and they pull in opposite directions:
 *  - a DEFAULT must be spelled the way the vocabulary spells it, so the select can show it;
 *  - a SAVED value must survive untouched, even one outside the vocabulary, because
 *    rewriting someone's dash on load is worse than a blank select.
 */
import { describe, it, expect } from 'vitest';
import { Correlogramclass } from './Correlogram.svelte';
import { STROKE_STYLES } from '$lib/components/plotbits/strokeStyles.js';

function mkPlot(datumJSON) {
	const wrapper = { id: 1, type: 'correlogram', name: 'c', width: 400, height: 300, plot: null };
	const c = new Correlogramclass(wrapper, null);
	c.addData(datumJSON ?? {});
	wrapper.plot = c;
	return c;
}

describe('correlogram confidence-bounds stroke', () => {
	it('defaults to a dash the Stroke select can actually show', () => {
		const stroke = mkPlot().data[0].confidenceLine.stroke;
		expect(STROKE_STYLES).toContain(stroke);
	});

	it('is dashed, not solid, by default', () => {
		expect(mkPlot().data[0].confidenceLine.stroke).not.toBe('solid');
	});

	it('keeps a saved dash that is not in the vocabulary, exactly as saved', () => {
		// What the shipped demo session contains.
		const c = mkPlot({ confidenceLine: { stroke: '5,5', strokeWidth: 1, draw: true } });
		expect(c.data[0].confidenceLine.stroke).toBe('5,5');
		expect(c.toJSON().data[0].confidenceLine.stroke).toBe('5,5');
	});
});
