// The violin overlay's plot-level options must round-trip through
// toJSON/fromJSON, old sessions that predate them must load with the defaults
// (violin off, box on — pixel-identical to before the feature), and the
// bandwidth's null-vs-0 semantics must survive: both mean "auto (Silverman)"
// at compute time, but what the user entered is what comes back.
import { describe, it, expect } from 'vitest';
import { Boxplotclass } from './Boxplot.svelte';

describe('Boxplot violin persistence', () => {
	it('defaults: violin off, box on, auto bandwidth, width 0.8, opacity 0.3', () => {
		const b = new Boxplotclass(null, null);
		expect(b.showViolin).toBe(false);
		expect(b.showBox).toBe(true);
		expect(b.violinBandwidth).toBe(null);
		expect(b.violinWidth).toBe(0.8);
		expect(b.violinOpacity).toBe(0.3);
	});

	it('round-trips violin on / box off with all fields', () => {
		const b = new Boxplotclass(null, null);
		b.showViolin = true;
		b.showBox = false;
		b.violinBandwidth = 1.5;
		b.violinWidth = 0.5;
		b.violinOpacity = 0.7;
		const back = Boxplotclass.fromJSON(null, JSON.parse(JSON.stringify(b.toJSON())));
		expect(back.showViolin).toBe(true);
		expect(back.showBox).toBe(false);
		expect(back.violinBandwidth).toBe(1.5);
		expect(back.violinWidth).toBe(0.5);
		expect(back.violinOpacity).toBe(0.7);
	});

	it('showBox false survives (?? not || — false is falsy)', () => {
		const b = new Boxplotclass(null, null);
		b.showBox = false;
		const back = Boxplotclass.fromJSON(null, b.toJSON());
		expect(back.showBox).toBe(false);
	});

	it('a saved bandwidth of 0 stays 0; null stays null (both mean auto)', () => {
		const b = new Boxplotclass(null, null);
		b.violinBandwidth = 0;
		expect(Boxplotclass.fromJSON(null, b.toJSON()).violinBandwidth).toBe(0);

		b.violinBandwidth = null;
		expect(Boxplotclass.fromJSON(null, b.toJSON()).violinBandwidth).toBe(null);
	});

	it('a violinOpacity of 0 survives the round-trip', () => {
		const b = new Boxplotclass(null, null);
		b.violinOpacity = 0;
		expect(Boxplotclass.fromJSON(null, b.toJSON()).violinOpacity).toBe(0);
	});

	it('an old session without any violin fields loads with the defaults', () => {
		const old = new Boxplotclass(null, null).toJSON();
		delete old.showViolin;
		delete old.showBox;
		delete old.violinBandwidth;
		delete old.violinWidth;
		delete old.violinOpacity;
		const back = Boxplotclass.fromJSON(null, old);
		expect(back.showViolin).toBe(false);
		expect(back.showBox).toBe(true);
		expect(back.violinBandwidth).toBe(null);
		expect(back.violinWidth).toBe(0.8);
		expect(back.violinOpacity).toBe(0.3);
	});

	it('violinWarnings gates: small groups and all-equal groups are named, violin off is silent', () => {
		const col = (vals) => ({
			getData: () => vals,
			refId: 1
		});
		const b = new Boxplotclass(null, null);
		// Hand-built series shaped like BoxPlotDataClass for the derived's reads.
		b.data = [
			{
				label: 'tiny',
				boxPlot: { draw: true },
				x: col([]),
				y: col([1, 2, 3])
			},
			{
				label: 'flat',
				boxPlot: { draw: true },
				x: col([]),
				y: col([2, 2, 2, 2, 2, 2])
			},
			{
				label: 'fine',
				boxPlot: { draw: true },
				x: col([]),
				y: col([1, 2, 3, 4, 5, 6])
			}
		];

		expect(b.violinWarnings).toEqual([]); // violin off — no warnings

		b.showViolin = true;
		const warnings = b.violinWarnings;
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain('tiny');
		expect(warnings[0]).toContain('3 points');
		expect(warnings[1]).toContain('flat');
		expect(warnings[1]).toContain('identical');
		expect(warnings.some((w) => w.includes('fine'))).toBe(false);
	});
});
