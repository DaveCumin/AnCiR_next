// Mean +/- SEM error bars take their series' colour. The constructor used to COPY the points'
// colour while the series was still unwired and not yet in its plot, so every series' bars
// got palette slot 0 (and saved it as if it were a pick). Now the colour is read at draw time
// unless the user picks one, and an automatic colour saves as null.
import { describe, it, expect } from 'vitest';
import { MeanSEMclass } from './MeanSEM.svelte';

function twoSeries() {
	const m = new MeanSEMclass(null, null);
	m.addData({});
	m.addData({});
	return m;
}

describe('MeanSEM error-bar colour', () => {
	it('follows each series’ own point colour', () => {
		const m = twoSeries();
		const [a, b] = m.data;
		expect(a.errorColour).toBe(a.points.colour);
		expect(b.errorColour).toBe(b.points.colour);
		expect(a.errorColour).not.toBe(b.errorColour);
	});

	it('saves an automatic colour as null and keeps a pick', () => {
		const m = twoSeries();
		expect(m.data[1].toJSON().errorColour).toBeNull();
		m.data[1].errorColour = '#ff0000';
		expect(m.data[1].errorColour).toBe('#ff0000');
		expect(m.data[1].toJSON().errorColour).toBe('#ff0000');
		m.data[1].errorColour = null;
		expect(m.data[1].errorColour).toBe(m.data[1].points.colour);
	});
});
