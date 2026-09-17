/**
 * Scatterplotclass ↔ OverlayClass integration (plan 2026-09-13, part B):
 * the `overlays` list that replaced `nightBands`, its persistence (toJSON
 * writes `overlays`, fromJSON reads it with `??` guards and MIGRATES a legacy
 * `nightBands` array), the legend items and download data overlays add, and
 * the auto-domain extension so a reference mark is never off-screen.
 *
 * Columns are REAL `Column` instances registered in `core`, so wired
 * resolution goes through the same getData() the renderers use.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { core } from '$lib/core/core.svelte.js';
import { Column } from '$lib/core/Column.svelte';
import { Scatterplotclass } from './Scatterplot.svelte';
import { OverlayClass } from './Overlay.svelte';

function mkCol(values, type = 'number') {
	const c = new Column({ type, data: -1 });
	core.rawData.set(c.id, values);
	c.data = c.id;
	core.data.push(c);
	return c.id;
}

/** A scatter with one number series x=0..9, y=10..19. */
function mkScatter() {
	const xId = mkCol([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	const yId = mkCol([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
	const parentBox = { id: 1, width: 400, height: 300 };
	const s = new Scatterplotclass(parentBox, null);
	s.parentBox = parentBox;
	s.addData({ x: { refId: xId }, y: { refId: yId } });
	return { s, xId, yId };
}

beforeEach(() => {
	core.data = [];
	core.rawData = new Map();
});

describe('Scatterplotclass.overlays', () => {
	it('starts empty and has no nightBands field any more', () => {
		const { s } = mkScatter();
		expect(s.overlays).toEqual([]);
		expect('nightBands' in s).toBe(false);
	});

	it('addOverlay constructs, pushes and returns; removeOverlay removes by id', () => {
		const { s } = mkScatter();
		const line = s.addOverlay('line');
		const band = s.addOverlay('band', 'vertical');
		expect(line).toBeInstanceOf(OverlayClass);
		expect(s.overlays).toEqual([line, band]);
		expect(line.kind).toBe('line');
		expect(band.kind).toBe('band');
		expect(band.form).toBe('vertical');
		expect(line.parentPlot).toBe(s);

		s.removeOverlay(line.id);
		expect(s.overlays).toEqual([band]);
		s.removeOverlay(9999); // unknown id: no-op
		expect(s.overlays).toEqual([band]);
	});

	it('addNightBand (legacy wrapper for aiEdit/MCP feature detection) creates a repeating band', () => {
		const { s } = mkScatter();
		const o = s.addNightBand({
			name: 'Night',
			nightDurationHours: 10,
			useDataMin: false,
			startTimeHours: 2
		});
		expect(o.kind).toBe('band');
		expect(o.form).toBe('repeating');
		expect(o.name).toBe('Night');
		expect(o.nightDurationHours).toBe(10);
		expect(o.startTimeHours).toBe(2);
		expect(s.overlays).toEqual([o]);
	});
});

describe('persistence', () => {
	it('toJSON writes overlays (not nightBands) and round-trips through fromJSON', () => {
		const { s, xId } = mkScatter();
		const line = s.addOverlay('line', 'horizontal');
		line.setTyped('at', [12, 15]);
		line.label = 'threshold';
		const band = s.addOverlay('band', 'ribbon');
		band.setWire('x', xId);
		band.fill = '#FF000033';

		const json = JSON.parse(JSON.stringify(s.toJSON()));
		expect('nightBands' in json).toBe(false);
		expect(json.overlays).toHaveLength(2);
		expect(json.overlays[0]).toMatchObject({
			kind: 'line',
			form: 'horizontal',
			label: 'threshold',
			channels: { at: { columns: [], typed: [12, 15] } }
		});
		expect(json.overlays[1].channels.x.columns).toEqual([{ refId: xId }]);

		const parentBox = { id: 2, width: 400, height: 300 };
		const back = Scatterplotclass.fromJSON(parentBox, json);
		expect(back.overlays).toHaveLength(2);
		expect(back.overlays[0].values('at')).toEqual([12, 15]);
		expect(back.overlays[0].label).toBe('threshold');
		expect(back.overlays[1].values('x')).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(back.overlays[1].fill).toBe('#FF000033');
		expect(back.overlays[1].parentPlot).toBe(back);
	});

	it('fromJSON tolerates a missing/partial overlays field (?? guards)', () => {
		expect(Scatterplotclass.fromJSON(null, { data: [] }).overlays).toEqual([]);
		const s = Scatterplotclass.fromJSON(null, { data: [], overlays: [{}] });
		expect(s.overlays).toHaveLength(1);
		expect(s.overlays[0].kind).toBe('line');
	});

	describe('legacy nightBands migration on the shipped demo-scatter-rhythm session', () => {
		// The pinned numbers were captured from NightBandClass on this very plot
		// (xlims [0, 167], number x) before NightBand.svelte was deleted.
		const DEMO = 'static/sessions/demos/demo-scatter-rhythm.json';
		const NIGHTBAND_REPEATING_SEGMENTS = [
			{ x0: 0, x1: 12 },
			{ x0: 24, x1: 36 },
			{ x0: 48, x1: 60 },
			{ x0: 72, x1: 84 },
			{ x0: 96, x1: 108 },
			{ x0: 120, x1: 132 },
			{ x0: 144, x1: 156 }
		];
		const NIGHTBAND_CUSTOM_SEGMENTS = [
			{ x0: 10, x1: 15 },
			{ x0: 40, x1: 52 }
		];

		function loadDemoScatter(extraInner) {
			const demo = JSON.parse(readFileSync(DEMO, 'utf8'));
			const p = demo.plots.find((x) => x.type === 'scatterplot');
			const refIds = new Set(p.plot.data.flatMap((d) => [d.x.refId, d.y.refId]));
			for (const c of demo.data) {
				if (!refIds.has(c.id)) continue;
				const col = new Column({ type: c.type, data: -1 }, c.id);
				core.rawData.set(col.id, demo.rawData[c.data]);
				col.data = col.id;
				core.data.push(col);
			}
			const parentBox = { id: p.id, width: p.width, height: p.height };
			const s = Scatterplotclass.fromJSON(parentBox, { ...p.plot, ...extraInner });
			s.parentBox = parentBox;
			return s;
		}

		it('the shipped session still carries the legacy (empty) nightBands key', () => {
			const demo = JSON.parse(readFileSync(DEMO, 'utf8'));
			const p = demo.plots.find((x) => x.type === 'scatterplot');
			expect(p.plot.nightBands).toEqual([]);
		});

		it('a repeating night band becomes a repeating band overlay with identical segments', () => {
			const s = loadDemoScatter({
				nightBands: [
					{
						id: 0,
						name: 'Night',
						mode: 'repeating',
						colour: '#2C2C2C30',
						enabled: true,
						repeatEveryHours: 24,
						nightDurationHours: 12,
						startTimeHours: 0,
						useDataMin: true,
						customBands: []
					}
				]
			});
			expect(s.xlims).toEqual([0, 167]);
			expect(s.anyXdataTime).toBe(false);
			expect(s.overlays).toHaveLength(1);
			const o = s.overlays[0];
			expect(o.kind).toBe('band');
			expect(o.form).toBe('repeating');
			expect(o.name).toBe('Night');
			expect(o.fill).toBe('#2C2C2C30');
			expect(o.geometry({}).segments).toEqual(NIGHTBAND_REPEATING_SEGMENTS);
			// Saving again writes the migrated shape only.
			const json = JSON.parse(JSON.stringify(s.toJSON()));
			expect(json.nightBands).toBeUndefined();
			expect(json.overlays[0].form).toBe('repeating');
		});

		it('a custom night band becomes a vertical band with typed start/end, identical segments', () => {
			const s = loadDemoScatter({
				nightBands: [
					{
						name: 'Custom',
						mode: 'custom',
						colour: '#2C2C2C30',
						enabled: false,
						customBands: [
							{ label: 'a', startTime: 10, durationHours: 5 },
							{ label: 'b', startTime: 40, endTime: 52 }
						]
					}
				]
			});
			const o = s.overlays[0];
			expect(o.form).toBe('vertical');
			expect(o.enabled).toBe(false);
			expect(o.geometry({}).segments).toEqual(NIGHTBAND_CUSTOM_SEGMENTS);
		});

		it('migrated bands come AFTER saved overlays, and the series data is still wired', () => {
			const s = loadDemoScatter({
				overlays: [{ kind: 'line', form: 'vertical', channels: { at: { typed: [50] } } }],
				nightBands: [{ mode: 'repeating' }]
			});
			expect(s.overlays.map((o) => o.kind)).toEqual(['line', 'band']);
			expect(s.data).toHaveLength(1);
			expect(s.data[0].y.getData().length).toBeGreaterThan(0);
		});
	});
});

describe('legend', () => {
	it('labelled, enabled overlays add a legend item after the series; unlabelled or disabled ones do not', () => {
		const { s } = mkScatter();
		const line = s.addOverlay('line');
		line.setTyped('at', [3]);
		line.label = 'alert';
		line.colour = '#C0392B';
		const silent = s.addOverlay('line');
		silent.setTyped('at', [4]);
		const band = s.addOverlay('band', 'horizontal');
		band.setTyped('lower', [1]);
		band.setTyped('upper', [2]);
		band.label = 'night';
		band.enabled = false;

		const items = s.getLegendItems;
		expect(items).toHaveLength(2);
		expect(items[0].label).not.toBe('alert'); // the series comes first
		expect(items[1]).toEqual({
			label: 'alert',
			elements: [{ type: 'line', color: '#C0392B', strokeWidth: 1.5, stroke: '5, 5' }]
		});

		band.enabled = true;
		expect(s.getLegendItems.map((i) => i.label)).toContain('night');
	});
});

describe('getDownloadData', () => {
	it("emits each enabled overlay's resolved positions/edges under its name", () => {
		const { s } = mkScatter();
		const line = s.addOverlay('line');
		line.name = 'alert';
		line.setTyped('at', [3, 7]);
		const band = s.addOverlay('band', 'horizontal');
		band.name = 'zone';
		band.setTyped('lower', [1]);
		band.setTyped('upper', [2]);
		const off = s.addOverlay('line');
		off.setTyped('at', [5]);
		off.enabled = false;

		const { headers, rows } = s.getDownloadData();
		const label = s.data[0].displayLabel;
		expect(headers.slice(0, 2)).toEqual([`x_${label}`, `y_${label}`]);
		expect(headers.slice(2)).toEqual(['alert_at', 'zone_lower', 'zone_upper']);
		expect(rows).toHaveLength(10); // the series is longest
		expect(rows[0].slice(2)).toEqual([3, 1, 2]);
		expect(rows[1].slice(2)).toEqual([7, '', '']);
		expect(rows[2].slice(2)).toEqual(['', '', '']);
	});

	it('a ribbon emits x/lower/upper; a repeating band emits its clipped segments', () => {
		const { s, xId } = mkScatter();
		const ribbon = s.addOverlay('band', 'ribbon');
		ribbon.name = 'ci';
		ribbon.setWire('x', xId);
		ribbon.setTyped('lower', Array(10).fill(9));
		ribbon.setTyped('upper', Array(10).fill(21));
		const night = s.addOverlay('band', 'repeating');
		night.name = 'night';
		night.repeatEveryHours = 4;
		night.nightDurationHours = 2;

		const { headers, rows } = s.getDownloadData();
		expect(headers.slice(2)).toEqual(['ci_x', 'ci_lower', 'ci_upper', 'night_start', 'night_end']);
		expect(rows[0].slice(2)).toEqual([0, 9, 21, 0, 2]);
		expect(rows[1].slice(2)).toEqual([1, 9, 21, 4, 6]);
	});

	it('vertical line positions on a time x axis are written as ISO strings like series x', () => {
		const t0 = Date.UTC(2026, 0, 1);
		const xId = mkCol([t0, t0 + 3600000], 'time');
		const yId = mkCol([1, 2]);
		const parentBox = { id: 1, width: 400, height: 300 };
		const s = new Scatterplotclass(parentBox, null);
		s.parentBox = parentBox;
		s.addData({ x: { refId: xId }, y: { refId: yId } });
		const line = s.addOverlay('line');
		line.name = 'mark';
		line.setTyped('at', [t0 + 1800000]);
		const { headers, rows } = s.getDownloadData();
		expect(headers[2]).toBe('mark_at');
		expect(rows[0][2]).toBe('2026-01-01T00:30:00.000Z');
	});
});

describe('auto-domain extension', () => {
	it('a vertical line beyond the data widens the AUTO x domain; manual limits win', () => {
		const { s } = mkScatter();
		expect(s.xlims).toEqual([0, 9]);
		const line = s.addOverlay('line');
		line.setTyped('at', [-2, 14.5]);
		expect(s.xlims).toEqual([-2, 14.5]);
		line.enabled = false;
		expect(s.xlims).toEqual([0, 9]);
		line.enabled = true;
		s.xlimsIN = [1, null];
		expect(s.xlims).toEqual([1, 14.5]);
	});

	it('a horizontal band beyond the data widens the AUTO left y domain', () => {
		const { s } = mkScatter();
		expect(s.ylimsLeft).toEqual([10, 19]);
		const band = s.addOverlay('band', 'horizontal');
		band.setTyped('lower', [5]);
		band.setTyped('upper', [25]);
		expect(s.ylimsLeft).toEqual([5, 25]);
		s.ylimsLeftIN = [null, 20];
		expect(s.ylimsLeft).toEqual([5, 20]);
	});

	it('a ribbon extends both axes; a repeating band extends neither', () => {
		const { s } = mkScatter();
		const ribbon = s.addOverlay('band', 'ribbon');
		ribbon.setTyped('x', [2, 12]);
		ribbon.setTyped('lower', [8, 8]);
		ribbon.setTyped('upper', [30, 30]);
		expect(s.xlims).toEqual([0, 12]);
		expect(s.ylimsLeft).toEqual([8, 30]);
		s.removeOverlay(ribbon.id);
		const night = s.addOverlay('band', 'repeating');
		night.repeatEveryHours = 4;
		expect(s.xlims).toEqual([0, 9]);
		expect(s.ylimsLeft).toEqual([10, 19]);
	});

	it('an empty plot stays at its benign [0, 0] domain even with overlays', () => {
		const parentBox = { id: 1, width: 400, height: 300 };
		const s = new Scatterplotclass(parentBox, null);
		s.parentBox = parentBox;
		const line = s.addOverlay('line');
		line.setTyped('at', [5]);
		expect(s.xlims).toEqual([0, 0]);
	});
});
