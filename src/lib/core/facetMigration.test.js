// @ts-nocheck
// One-way migration of legacy facet CHILD plots into the views model (plan
// 2026-09-26-facets-as-views, section 2.2). Pure JSON in, JSON + warnings out.
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateFacetChildren } from '$lib/core/facetMigration.js';
import { childDefaultsFromRegistry, defaultChildFor } from '$lib/core/facetMigrationDefaults.js';
import { loadPlots } from '$test/plotRegistry.js';

// --- hand-built session JSON -------------------------------------------------

const axis = (label = '') => ({ label, gridlines: true, nticks: 6, manualTicks: null });
const legend = () => ({ show: false, position: 'top-right' });
const col = (refId, id) => ({ id, refId, name: `c${refId}`, type: 'number', processes: [] });

function scatterInner(series, extra = {}) {
	return {
		xlimsIN: [null, null],
		xLogScale: false,
		xTickFormat: '',
		ylimsLeftIN: [null, null],
		ylimsRightIN: [null, null],
		yLogScaleLeft: false,
		yLogScaleRight: false,
		padding: { top: 15, right: 30, bottom: 30, left: 30 },
		xAxis: axis(),
		yAxisLeft: axis(),
		yAxisRight: axis(),
		data: series,
		legend: legend(),
		overlays: [],
		...extra
	};
}

function scatterSeries(xRef, yRef, extra = {}) {
	return {
		x: col(xRef, 1000 + xRef),
		y: col(yRef, 1000 + yRef),
		label: '',
		yAxis: 'left',
		line: { colour: null, strokeWidth: 2, show: false },
		points: { colour: null, radius: 4, show: true },
		...extra
	};
}

function histInner(refs, extra = {}) {
	return {
		xlimsIN: [null, null],
		ylimsIN: [null, null],
		padding: { top: 15, right: 30, bottom: 30, left: 50 },
		xAxis: axis(),
		yAxis: axis('Count'),
		data: refs.map((r) => ({
			column: col(r, 2000 + r),
			label: '',
			binMode: 'auto',
			fillColour: null
		})),
		legend: legend(),
		...extra
	};
}

function actInner(series, extra = {}) {
	return {
		ylimsOption: 'overall',
		ylimsIN: [0, 100],
		paddingIN: { top: 30, right: 20, bottom: 10, left: 20 },
		doublePlot: 1,
		periodHrs: 24,
		rowLabels: 'dates',
		dateFormat: 'YYYY-MM-DD',
		renderMode: 'bars',
		colormap: 'viridis',
		lightBands: { lightBands: [] },
		legend: legend(),
		annotations: [],
		xAxis: axis(),
		data: series,
		...extra
	};
}

const actSeries = (xRef, yRef, phaseMarkers) => ({
	x: col(xRef, 3000 + xRef),
	y: col(yRef, 3000 + yRef),
	label: '',
	colour: '#234154',
	draw: true,
	...(phaseMarkers ? { phaseMarkers } : {})
});

const MANUAL_BLOCK = {
	name: 'manual_0',
	type: 'manual',
	colour: '#234154',
	showLine: false,
	showMarkers: true,
	lineWidth: 1,
	markerSize: 5,
	manualMarkers: [30.5, 54.25]
};

function plot(id, name, type, inner, extra = {}) {
	return {
		id,
		name,
		x: 40,
		y: 40,
		width: 500,
		height: 250,
		type,
		selected: false,
		facet: false,
		facetParent: null,
		facetKey: null,
		facetRows: 0,
		setRefs: {},
		metricOut: {},
		sourceNodeId: null,
		style: { typeface: 'sans' },
		plot: inner,
		...extra
	};
}

const child = (id, name, type, inner, parent, key) =>
	plot(id, name, type, inner, { facetParent: parent, facetKey: key, x: 40, y: 400 });

const session = (plots) => ({ version: 76, data: [], rawData: {}, plots, tableProcesses: [] });

const stripped = (p) => {
	expect(p).not.toHaveProperty('facetParent');
	expect(p).not.toHaveProperty('facetKey');
};

// --- cases --------------------------------------------------------------------

describe('migrateFacetChildren: sessions without children', () => {
	it('returns the SAME object and no warnings for a session with no facets at all', () => {
		const s = session([plot(1, 'Raw', 'scatterplot', scatterInner([scatterSeries(10, 11)]))]);
		const out = migrateFacetChildren(s);
		expect(out.json).toBe(s);
		expect(out.warnings).toEqual([]);
		// The null fields every shipped session carries are left for Plot.fromJSON to ignore.
		expect(s.plots[0]).toHaveProperty('facetParent', null);
	});

	it('a generator with no children in the file (every shipped session) is untouched', () => {
		const s = session([
			plot(7, 'Distributions', 'histogram', histInner([112, 113]), { facet: true })
		]);
		const out = migrateFacetChildren(s);
		expect(out.json).toBe(s);
		expect(out.warnings).toEqual([]);
	});

	it('tolerates a session with no plots array', () => {
		const s = { version: 76 };
		expect(migrateFacetChildren(s)).toEqual({ json: s, warnings: [], mapping: [] });
		expect(migrateFacetChildren(null)).toEqual({ json: null, warnings: [], mapping: [] });
	});
});

describe('migrateFacetChildren: the plain case', () => {
	const gen = () =>
		plot(7, 'Distributions', 'histogram', histInner([112, 113, 114, 115]), { facet: true });
	const kids = () => [
		child(13, 'c112', 'histogram', histInner([112]), 7, '7:0:112'),
		child(14, 'c113', 'histogram', histInner([113]), 7, '7:1:113'),
		child(15, 'c114', 'histogram', histInner([114]), 7, '7:2:114'),
		child(16, 'c115', 'histogram', histInner([115]), 7, '7:3:115')
	];

	it('drops every child, strips facetParent/facetKey from every plot, keeps the generator and the rest', () => {
		const other = plot(8, 'Table', 'tableplot', { columnRefs: [112] });
		const s = session([gen(), ...kids(), other]);
		const { json, warnings, mapping } = migrateFacetChildren(s);
		expect(warnings).toEqual([]);
		expect(json.plots.map((p) => p.id)).toEqual([7, 8]);
		expect(mapping).toEqual([
			{ plotId: 13, generatorId: 7, unitKey: 'c112#0' },
			{ plotId: 14, generatorId: 7, unitKey: 'c113#0' },
			{ plotId: 15, generatorId: 7, unitKey: 'c114#0' },
			{ plotId: 16, generatorId: 7, unitKey: 'c115#0' }
		]);
		json.plots.forEach(stripped);
		expect(json.plots[0].facet).toBe(true);
		expect(json.plots[0]).not.toHaveProperty('facetOverrides');
		// Pure: the input is not mutated.
		expect(s.plots).toHaveLength(6);
		expect(s.plots[1].facetParent).toBe(7);
	});

	it('is idempotent: a second run on the output is a no-op', () => {
		const first = migrateFacetChildren(session([gen(), ...kids()]));
		const second = migrateFacetChildren(first.json);
		expect(second.json).toBe(first.json);
		expect(second.warnings).toEqual([]);
	});

	it('a child whose facetKey no longer matches a wired series is a stale panel and is dropped', () => {
		const stale = child(99, 'c999', 'histogram', histInner([999]), 7, '7:9:999');
		const { json, warnings } = migrateFacetChildren(session([gen(), ...kids(), stale]));
		expect(json.plots.map((p) => p.id)).toEqual([7]);
		expect(warnings).toEqual([
			"Plot 'c999' was a stale facet panel of 'Distributions' (its series is no longer wired to the plot); it was dropped"
		]);
	});
});

describe('migrateFacetChildren: orphans (step 1 and 6)', () => {
	it('a child whose generator is missing is dropped with the plan wording', () => {
		const s = session([child(13, 'weight', 'histogram', histInner([112]), 42, '42:0:112')]);
		const { json, warnings } = migrateFacetChildren(s);
		expect(json.plots).toEqual([]);
		expect(warnings).toEqual([
			"Plot 'weight' was a facet panel of a plot that no longer exists; it was dropped"
		]);
	});

	it('a child whose parent exists but is no longer a generator is dropped the same way', () => {
		const parent = plot(7, 'Distributions', 'histogram', histInner([112]));
		const s = session([parent, child(13, 'weight', 'histogram', histInner([112]), 7, '7:0:112')]);
		const { json, warnings } = migrateFacetChildren(s);
		expect(json.plots.map((p) => p.id)).toEqual([7]);
		stripped(json.plots[0]);
		expect(warnings).toEqual([
			"Plot 'weight' was a facet panel of a plot that no longer exists; it was dropped"
		]);
	});

	it('groups the lines of several orphans of one missing generator into ONE warning', () => {
		const s = session([
			child(13, 'weight', 'histogram', histInner([112]), 42, '42:0:112'),
			child(14, 'height', 'histogram', histInner([113]), 42, '42:1:113')
		]);
		const { warnings } = migrateFacetChildren(s);
		expect(warnings).toEqual([
			"Plot 'weight' was a facet panel of a plot that no longer exists; it was dropped\n" +
				"Plot 'height' was a facet panel of a plot that no longer exists; it was dropped"
		]);
	});
});

describe('migrateFacetChildren: per-panel whole-plot differences (step 3)', () => {
	const x = 10;
	const gen = (extra) =>
		plot(
			5,
			'Sc',
			'scatterplot',
			scatterInner([scatterSeries(x, 11), scatterSeries(x, 12), scatterSeries(x, 13)], extra),
			{ facet: true }
		);

	it('axis limits on a child become that unit’s Phase 1 override, with no warning', () => {
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], { ylimsLeftIN: [0, 10] }),
			5,
			'5:0:11'
		);
		const b = child(21, 'c12', 'scatterplot', scatterInner([scatterSeries(x, 12)]), 5, '5:1:12');
		const c = child(
			22,
			'c13',
			'scatterplot',
			scatterInner([scatterSeries(x, 13)], { xlimsIN: [null, 3] }),
			5,
			'5:2:13'
		);
		const { json, warnings } = migrateFacetChildren(session([gen(), a, b, c]));
		expect(warnings).toEqual([]);
		expect(json.plots).toHaveLength(1);
		expect(json.plots[0].facetOverrides).toEqual({
			'y11#0': { 'ylimsLeftIN[0]': 0, 'ylimsLeftIN[1]': 10 },
			'y13#0': { 'xlimsIN[1]': 3 }
		});
	});

	it('a non-limit difference (padding) is reported in the plan wording and not written anywhere', () => {
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], {
				padding: { top: 40, right: 30, bottom: 30, left: 30 }
			}),
			5,
			'5:0:11'
		);
		const { json, warnings } = migrateFacetChildren(session([gen(), a]));
		expect(json.plots[0]).not.toHaveProperty('facetOverrides');
		expect(warnings).toEqual([
			"Panel 'c11' of 'Sc' had its own Padding Top (40); facets now share the plot's value (15)"
		]);
	});

	it('scalar, nested-object and axis leaves are all diffed; series rows and overlays are not', () => {
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], {
				xLogScale: true,
				xAxis: axis('Time (h)'),
				overlays: [{ id: 3, kind: 'line', form: 'vertical' }]
			}),
			5,
			'5:0:11'
		);
		const { warnings } = migrateFacetChildren(session([gen(), a]));
		expect(warnings).toEqual([
			"Panel 'c11' of 'Sc' had its own X Log Scale (true); facets now share the plot's value (false)\n" +
				"Panel 'c11' of 'Sc' had its own X Axis Label (\"Time (h)\"); facets now share the plot's value (\"\")"
		]);
	});

	it('a limit AND a reported difference on one child: the limit is carried, the rest reported', () => {
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], { ylimsLeftIN: [0, 10], yLogScaleLeft: true }),
			5,
			'5:0:11'
		);
		const { json, warnings } = migrateFacetChildren(session([gen(), a]));
		expect(json.plots[0].facetOverrides).toEqual({
			'y11#0': { 'ylimsLeftIN[0]': 0, 'ylimsLeftIN[1]': 10 }
		});
		expect(warnings).toEqual([
			"Panel 'c11' of 'Sc' had its own Y Log Scale Left (true); facets now share the plot's value (false)"
		]);
	});
});

describe('migrateFacetChildren: per-series differences (step 4)', () => {
	const x = 10;

	it('a restyled child series is reported, never written onto the generator', () => {
		const gen = plot(
			5,
			'Sc',
			'scatterplot',
			scatterInner([scatterSeries(x, 11), scatterSeries(x, 12)]),
			{ facet: true }
		);
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11, { points: { colour: null, radius: 6, show: true } })]),
			5,
			'5:0:11'
		);
		const { json, warnings } = migrateFacetChildren(session([gen, a]));
		expect(json.plots[0].plot.data[0].points.radius).toBe(4);
		expect(warnings).toEqual([
			"Panel 'c11' of 'Sc' had its own series 1 Points Radius (6); facets now share the plot's value (4)"
		]);
	});

	it('a paired second x-set maps the child’s second series onto the generator’s series by position', () => {
		// Set 1 (x=10): y 11, 12. Set 2 (x=20, the fit): y 31, 32. Child 0 shows [11, 31].
		const gen = plot(
			5,
			'Sc',
			'scatterplot',
			scatterInner([
				scatterSeries(x, 11),
				scatterSeries(x, 12),
				scatterSeries(20, 31),
				scatterSeries(20, 32)
			]),
			{ facet: true }
		);
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([
				scatterSeries(x, 11),
				scatterSeries(20, 31, { line: { colour: '#ff0000', strokeWidth: 2, show: false } })
			]),
			5,
			'5:0:11'
		);
		const { warnings } = migrateFacetChildren(session([gen, a]));
		expect(warnings).toEqual([
			"Panel 'c11' of 'Sc' had its own series 3 Line Colour (\"#ff0000\"); facets now share the plot's value (null)"
		]);
	});

	it('actogram phase markers on a child series, absent on the generator series, are MOVED onto it', () => {
		const gen = plot(9, 'Act', 'actogram', actInner([actSeries(40, 41), actSeries(40, 42)]), {
			facet: true
		});
		const b = child(
			30,
			'c42',
			'actogram',
			actInner([actSeries(40, 42, [MANUAL_BLOCK])]),
			9,
			'9:1:42'
		);
		const { json, warnings } = migrateFacetChildren(session([gen, b]));
		expect(json.plots).toHaveLength(1);
		expect(json.plots[0].plot.data[1].phaseMarkers).toEqual([MANUAL_BLOCK]);
		expect(json.plots[0].plot.data[0]).not.toHaveProperty('phaseMarkers');
		expect(warnings).toEqual([
			"Panel 'c42' of 'Act' had 1 phase marker block; it was moved onto the plot's series 2"
		]);
	});

	it('phase markers present on BOTH are reported, not moved', () => {
		const onset = { ...MANUAL_BLOCK, name: 'onset_0', type: 'onset', manualMarkers: [] };
		const gen = plot(9, 'Act', 'actogram', actInner([actSeries(40, 41, [onset])]), { facet: true });
		const a = child(
			30,
			'c41',
			'actogram',
			actInner([actSeries(40, 41, [MANUAL_BLOCK, onset])]),
			9,
			'9:0:41'
		);
		const { json, warnings } = migrateFacetChildren(session([gen, a]));
		expect(json.plots[0].plot.data[0].phaseMarkers).toEqual([onset]);
		expect(warnings).toEqual([
			"Panel 'c41' of 'Act' had its own phase markers (2 blocks); facets now use the plot's series 1 markers (1 block)"
		]);
	});

	it('an actogram limit still carries as an override (ylimsIN)', () => {
		const gen = plot(9, 'Act', 'actogram', actInner([actSeries(40, 41)]), { facet: true });
		const a = child(
			30,
			'c41',
			'actogram',
			actInner([actSeries(40, 41)], { ylimsIN: [0, 50] }),
			9,
			'9:0:41'
		);
		const { json, warnings } = migrateFacetChildren(session([gen, a]));
		expect(warnings).toEqual([]);
		// Actogram is an x/y type, so the role is `y`; only index 1 differs from [0, 100].
		expect(json.plots[0].facetOverrides).toEqual({ 'y41#0': { 'ylimsIN[1]': 50 } });
	});
});

describe('migrateFacetChildren: autoscaled padding sides and the defaults hook (rules 2 and 1)', () => {
	const x = 10;
	const gen = (extra) =>
		plot(
			5,
			'Sc',
			'scatterplot',
			scatterInner([scatterSeries(x, 11), scatterSeries(x, 12)], extra),
			{ facet: true }
		);

	it('padding.left and padding.bottom differences are render residue and are never reported', () => {
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], {
				padding: { top: 15, right: 30, bottom: 35, left: 57 }
			}),
			5,
			'5:0:11'
		);
		const { warnings } = migrateFacetChildren(session([gen(), a]));
		expect(warnings).toEqual([]);
	});

	it('the actogram paddingIN is not autoscaled: all four sides are compared', () => {
		const g = plot(9, 'Act', 'actogram', actInner([actSeries(40, 41)]), { facet: true });
		const a = child(
			30,
			'c41',
			'actogram',
			actInner([actSeries(40, 41)], { paddingIN: { top: 30, right: 20, bottom: 10, left: 99 } }),
			9,
			'9:0:41'
		);
		const { warnings } = migrateFacetChildren(session([g, a]));
		expect(warnings).toEqual([
			"Panel 'c41' of 'Act' had its own Padding Left (99); facets now share the plot's value (20)"
		]);
	});

	it('with childDefaults, a value equal to the reconcile default is not reported; a real edit still is', () => {
		const genPlot = gen({ xAxis: axis('Day') });
		genPlot.plot.data[0].line = { colour: '#8A9BA8', strokeWidth: 2.5, show: true };
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11, { points: { colour: null, radius: 7, show: true } })], {
				xLogScale: true
			}),
			5,
			'5:0:11'
		);
		const b = child(21, 'c12', 'scatterplot', scatterInner([scatterSeries(x, 12)]), 5, '5:1:12');
		const childDefaults = (type) =>
			type === 'scatterplot'
				? {
						inner: { xAxis: { label: '' }, xLogScale: false },
						series: {
							label: '',
							line: { colour: null, strokeWidth: 2, show: false },
							points: { colour: null, radius: 4, show: true }
						}
					}
				: null;
		const without = migrateFacetChildren(session([genPlot, a, b]));
		const withHook = migrateFacetChildren(session([genPlot, a, b]), { childDefaults });
		// Without the hook: the axis label (both children), the log scale, the line style (both) and the radius.
		expect(without.warnings).toEqual([
			"Panel 'c11' of 'Sc' had its own X Log Scale (true); facets now share the plot's value (false)\n" +
				"Panel 'c11' of 'Sc' had its own X Axis Label (\"\"); facets now share the plot's value (\"Day\")\n" +
				"Panel 'c11' of 'Sc' had its own series 1 Line Colour (null); facets now share the plot's value (\"#8A9BA8\")\n" +
				"Panel 'c11' of 'Sc' had its own series 1 Line Stroke Width (2); facets now share the plot's value (2.5)\n" +
				"Panel 'c11' of 'Sc' had its own series 1 Line Show (false); facets now share the plot's value (true)\n" +
				"Panel 'c11' of 'Sc' had its own series 1 Points Radius (7); facets now share the plot's value (4)\n" +
				"Panel 'c12' of 'Sc' had its own X Axis Label (\"\"); facets now share the plot's value (\"Day\")"
		]);
		// With it: only what the user changed away from the default.
		expect(withHook.warnings).toEqual([
			"Panel 'c11' of 'Sc' had its own X Log Scale (true); facets now share the plot's value (false)\n" +
				"Panel 'c11' of 'Sc' had its own series 1 Points Radius (7); facets now share the plot's value (4)"
		]);
		// Limits carry regardless of the hook.
		const c = child(
			22,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], { ylimsLeftIN: [0, 1] }),
			5,
			'5:0:11'
		);
		expect(
			migrateFacetChildren(session([gen(), c]), { childDefaults }).json.plots[0].facetOverrides
		).toEqual({
			'y11#0': { 'ylimsLeftIN[0]': 0, 'ylimsLeftIN[1]': 1 }
		});
	});

	it('a hook that throws or returns nothing falls back to reporting everything', () => {
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], { xLogScale: true }),
			5,
			'5:0:11'
		);
		expect(
			migrateFacetChildren(session([gen(), a]), { childDefaults: () => null }).warnings
		).toHaveLength(1);
		expect(
			migrateFacetChildren(session([gen(), a]), { childDefaults: 'nope' }).warnings
		).toHaveLength(1);
	});
});

describe('migrateFacetChildren: duplicate legacy keys (rule 3, the v76.4 reload defect)', () => {
	it('keeps the lowest id (the file’s own, edited child), drops the minted duplicate with a warning', () => {
		const gen = plot(7, 'Distributions', 'histogram', histInner([112, 113]), { facet: true });
		const saved = child(
			13,
			'height',
			'histogram',
			histInner([112], { xlimsIN: [0, 9] }),
			7,
			'7:0:112'
		);
		const saved2 = child(14, 'weight', 'histogram', histInner([113]), 7, '7:1:113');
		const dup = child(18, 'height', 'histogram', histInner([112]), 7, '7:0:112');
		const dup2 = child(19, 'weight', 'histogram', histInner([113]), 7, '7:1:113');
		// Minted duplicates sit right after the generator in a reloaded-and-saved session.
		const { json, warnings, mapping } = migrateFacetChildren(
			session([gen, dup, dup2, saved, saved2])
		);
		expect(json.plots.map((p) => p.id)).toEqual([7]);
		expect(json.plots[0].facetOverrides).toEqual({
			'c112#0': { 'xlimsIN[0]': 0, 'xlimsIN[1]': 9 }
		});
		expect(mapping).toEqual([
			{ plotId: 13, generatorId: 7, unitKey: 'c112#0' },
			{ plotId: 14, generatorId: 7, unitKey: 'c113#0' }
		]);
		expect(warnings).toEqual([
			"Plot 'height' (id 18) was a duplicate facet panel of 'Distributions' (the same series as plot 13); it was dropped\n" +
				"Plot 'weight' (id 19) was a duplicate facet panel of 'Distributions' (the same series as plot 14); it was dropped"
		]);
	});

	it('a duplicate does not shift the ordinal of a twice-wired column', () => {
		const x = 10;
		const gen = plot(
			5,
			'Sc',
			'scatterplot',
			scatterInner([scatterSeries(x, 11), scatterSeries(x, 11)]),
			{ facet: true }
		);
		const a = child(20, 'c11', 'scatterplot', scatterInner([scatterSeries(x, 11)]), 5, '5:0:11');
		const b = child(21, 'c11', 'scatterplot', scatterInner([scatterSeries(x, 11)]), 5, '5:1:11');
		const dupA = child(30, 'c11', 'scatterplot', scatterInner([scatterSeries(x, 11)]), 5, '5:0:11');
		const { mapping } = migrateFacetChildren(session([gen, a, dupA, b]));
		expect(mapping).toEqual([
			{ plotId: 20, generatorId: 5, unitKey: 'y11#0' },
			{ plotId: 21, generatorId: 5, unitKey: 'y11#1' }
		]);
	});
});

describe('migrateFacetChildren: unit identity (step 2)', () => {
	const x = 10;

	it('the same column wired twice gives ordinals #0 and #1 in data order', () => {
		const gen = plot(
			5,
			'Sc',
			'scatterplot',
			scatterInner([scatterSeries(x, 11), scatterSeries(x, 12), scatterSeries(x, 11)]),
			{ facet: true }
		);
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], { ylimsLeftIN: [0, 1] }),
			5,
			'5:0:11'
		);
		const b = child(
			21,
			'c12',
			'scatterplot',
			scatterInner([scatterSeries(x, 12)], { ylimsLeftIN: [0, 2] }),
			5,
			'5:1:12'
		);
		const c = child(
			22,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], { ylimsLeftIN: [0, 3] }),
			5,
			'5:2:11'
		);
		// File order deliberately scrambled: ordinals come from the key index, not the file.
		const { json } = migrateFacetChildren(session([c, gen, a, b]));
		expect(json.plots[0].facetOverrides).toEqual({
			'y11#0': { 'ylimsLeftIN[0]': 0, 'ylimsLeftIN[1]': 1 },
			'y12#0': { 'ylimsLeftIN[0]': 0, 'ylimsLeftIN[1]': 2 },
			'y11#1': { 'ylimsLeftIN[0]': 0, 'ylimsLeftIN[1]': 3 }
		});
	});

	it('after a series reorder the keys follow the column, not the shifted index', () => {
		// Generator data order is now [12, 11]; the respawned children carry the shifted indices.
		const gen = plot(
			5,
			'Sc',
			'scatterplot',
			scatterInner([scatterSeries(x, 12), scatterSeries(x, 11)]),
			{ facet: true }
		);
		const a = child(
			30,
			'c12',
			'scatterplot',
			scatterInner([scatterSeries(x, 12)], { ylimsLeftIN: [0, 12] }),
			5,
			'5:0:12'
		);
		const b = child(
			31,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], { ylimsLeftIN: [0, 11] }),
			5,
			'5:1:11'
		);
		const { json } = migrateFacetChildren(session([gen, a, b]));
		expect(json.plots[0].facetOverrides).toEqual({
			'y12#0': { 'ylimsLeftIN[0]': 0, 'ylimsLeftIN[1]': 12 },
			'y11#0': { 'ylimsLeftIN[0]': 0, 'ylimsLeftIN[1]': 11 }
		});
	});

	it('column-based generators use the `c` role', () => {
		const gen = plot(7, 'Distributions', 'histogram', histInner([112, 113]), { facet: true });
		const a = child(13, 'c112', 'histogram', histInner([112], { xlimsIN: [0, 9] }), 7, '7:0:112');
		const { json } = migrateFacetChildren(session([gen, a]));
		expect(json.plots[0].facetOverrides).toEqual({
			'c112#0': { 'xlimsIN[0]': 0, 'xlimsIN[1]': 9 }
		});
	});

	it('merges into an existing facetOverrides map on the generator rather than replacing it', () => {
		const gen = plot(7, 'Distributions', 'histogram', histInner([112, 113]), {
			facet: true,
			facetOverrides: { 'c113#0': { 'ylimsIN[1]': 4 } }
		});
		const a = child(13, 'c112', 'histogram', histInner([112], { xlimsIN: [0, 9] }), 7, '7:0:112');
		const { json } = migrateFacetChildren(session([gen, a]));
		expect(json.plots[0].facetOverrides).toEqual({
			'c113#0': { 'ylimsIN[1]': 4 },
			'c112#0': { 'xlimsIN[0]': 0, 'xlimsIN[1]': 9 }
		});
	});
});

describe('migrateFacetChildren: warnings are grouped one entry per generator', () => {
	it('two generators with reported differences give two warnings, in generator order of first child', () => {
		const x = 10;
		const g1 = plot(5, 'Sc', 'scatterplot', scatterInner([scatterSeries(x, 11)]), { facet: true });
		const g2 = plot(7, 'Distributions', 'histogram', histInner([112]), { facet: true });
		const a = child(
			20,
			'c11',
			'scatterplot',
			scatterInner([scatterSeries(x, 11)], { xLogScale: true }),
			5,
			'5:0:11'
		);
		const h = child(
			13,
			'c112',
			'histogram',
			histInner([112], { padding: { top: 1, right: 30, bottom: 30, left: 50 } }),
			7,
			'7:0:112'
		);
		const { warnings } = migrateFacetChildren(session([g1, g2, h, a]));
		expect(warnings).toEqual([
			"Panel 'c112' of 'Distributions' had its own Padding Top (1); facets now share the plot's value (15)",
			"Panel 'c11' of 'Sc' had its own X Log Scale (true); facets now share the plot's value (false)"
		]);
	});
});

// --- browser-captured fixtures (plan 2.3) ------------------------------------
// Saved FROM THE BROWSER at v76.4 by a separate capture (see src/test/fixtures/README.md for
// the exact ids, keys and edits). Each case skips with a clear message if its file is absent,
// so this suite stays green on a checkout without the captures.
const FIXTURES = join(process.cwd(), 'src', 'test', 'fixtures');
const fixture = (name) => join(FIXTURES, `facet-${name}.json`);
const load = (name) => JSON.parse(readFileSync(fixture(name), 'utf8'));
// The test NAME carries the skip reason only while the file is absent.
const title = (name, what) =>
	existsSync(fixture(name))
		? `facet-${name}.json: ${what}`
		: `facet-${name}.json SKIPPED: fixture not captured at ${fixture(name)}`;

function expectMigratedShape(out) {
	for (const p of out.json.plots) {
		expect(p).not.toHaveProperty('facetParent');
		expect(p).not.toHaveProperty('facetKey');
	}
	// Idempotent on the captured session too.
	const again = migrateFacetChildren(out.json);
	expect(again.json).toBe(out.json);
	expect(again.warnings).toEqual([]);
}

describe('the reconcile’s default child, per type, from the registry (facetMigrationDefaults)', () => {
	it('builds inner + series defaults for every facetable type, through addData like a real child', async () => {
		const plotMap = await loadPlots();
		const hook = childDefaultsFromRegistry(plotMap);
		for (const type of [
			'scatterplot',
			'actogram',
			'correlogram',
			'periodogram',
			'fft',
			'histogram'
		]) {
			const d = hook(type);
			expect(d, type).toBeTruthy();
			expect(d.inner, type).not.toHaveProperty('data');
			expect(d.series, type).toBeTruthy();
			expect(hook(type), type).toBe(d); // memoised
		}
		// A child scatter series is points-on, lines-off (README fixture 2), which the
		// fromJSON path would NOT give: the defaults must come from addData.
		expect(hook('scatterplot').series.line.draw).toBe(false);
		expect(hook('scatterplot').series.points.draw).toBe(true);
		expect(hook('scatterplot').series.points.radius).toBe(4);
		expect(hook('scatterplot').inner.xAxis.label).toBe('');
		expect(hook('histogram').series.fillColour).toBe('#234154');
		expect(hook('actogram').series.colour).toBe('#234154');
		expect(hook('nope')).toBeNull();
		expect(defaultChildFor(null, 'scatterplot')).toBeNull();
	});
});

describe('browser-captured fixtures (with the registry defaults hook, as importJson runs it)', () => {
	let hook;
	beforeAll(async () => {
		hook = childDefaultsFromRegistry(await loadPlots());
	});

	it.skipIf(!existsSync(fixture('eda-children')))(title('eda-children', 'the plain case'), () => {
		const s = load('eda-children');
		expect(s.plots.map((p) => p.id)).toEqual([7, 13, 14, 15, 16, 8, 9, 10, 11]);
		const out = migrateFacetChildren(s, { childDefaults: hook });
		expect(out.json.plots.map((p) => p.id)).toEqual([7, 8, 9, 10, 11]);
		expect(out.mapping).toEqual([
			{ plotId: 13, generatorId: 7, unitKey: 'c112#0' },
			{ plotId: 14, generatorId: 7, unitKey: 'c113#0' },
			{ plotId: 15, generatorId: 7, unitKey: 'c114#0' },
			{ plotId: 16, generatorId: 7, unitKey: 'c115#0' }
		]);
		// Plain children: nothing to carry, nothing to report.
		expect(out.warnings).toEqual([]);
		expect(out.json.plots[0]).not.toHaveProperty('facetOverrides');
		expectMigratedShape(out);
	});

	it.skipIf(!existsSync(fixture('scatter-edited-children')))(
		title('scatter-edited-children', 'y-limits carried, padding and marker size reported'),
		() => {
			const s = load('scatter-edited-children');
			const out = migrateFacetChildren(s, { childDefaults: hook });
			const gen = out.json.plots.find((p) => p.id === 49);
			expect(out.json.plots.some((p) => [53, 54, 55].includes(p.id))).toBe(false);
			expect(out.mapping).toEqual([
				{ plotId: 53, generatorId: 49, unitKey: 'y375#0' },
				{ plotId: 54, generatorId: 49, unitKey: 'y376#0' },
				{ plotId: 55, generatorId: 49, unitKey: 'y377#0' }
			]);
			// Child 53's y-limits carry as the Phase 1 override.
			expect(gen.facetOverrides).toEqual({
				'y375#0': { 'ylimsLeftIN[0]': 10, 'ylimsLeftIN[1]': 40 }
			});
			// Child 54's padding (top, right) and child 55's marker edit are reported. The marker
			// edit pinned the series colour too (editing a series pins its automatic colour), so
			// that per-series value is reported beside the radius.
			const N = "'Onset vs day — immediate delay versus advance transients'";
			expect(out.warnings).toEqual([
				`Panel 'onset_delay' of ${N} had its own Padding Top (40); facets now share the plot's value (15)\n` +
					`Panel 'onset_delay' of ${N} had its own Padding Right (50); facets now share the plot's value (30)\n` +
					`Panel 'onset_advance' of ${N} had its own series 3 Points Colour ("#A6ACD5"); facets now share the plot's value ("#BE796B")\n` +
					`Panel 'onset_advance' of ${N} had its own series 3 Points Radius (7); facets now share the plot's value (3)`
			]);
			// Never written onto the generator.
			expect(gen.plot.data[2].points.radius).toBe(3);
			expect(gen.plot.padding.top).toBe(15);
			expectMigratedShape(out);
		}
	);

	it.skipIf(!existsSync(fixture('actogram-markers')))(
		title('actogram-markers', 'marker blocks move onto the generator series'),
		() => {
			const s = load('actogram-markers');
			const out = migrateFacetChildren(s, { childDefaults: hook });
			const gen = out.json.plots.find((p) => p.id === 0);
			expect(out.mapping).toEqual([
				{ plotId: 4, generatorId: 0, unitKey: 'y1#0' },
				{ plotId: 5, generatorId: 0, unitKey: 'y7#0' }
			]);
			// Both blocks of child 4 move onto generator series 0; series 1 gets nothing.
			const blocks = gen.plot.data[0].phaseMarkers;
			expect(blocks.map((b) => b.type)).toEqual(['onset', 'manual']);
			expect(blocks[1].manualMarkers).toEqual([59.97525773195876, 136.82474226804123]);
			expect(gen.plot.data[1].phaseMarkers ?? []).toEqual([]);
			expect(gen).not.toHaveProperty('facetOverrides');
			expect(out.warnings).toEqual([
				"Panel 'Consolidated1' of 'Representative actograms' had 2 phase marker blocks; it was moved onto the plot's series 1"
			]);
			expectMigratedShape(out);
		}
	);

	it.skipIf(!existsSync(fixture('reordered-children')))(
		title('reordered-children', 'keys follow the column, not the index'),
		() => {
			const s = load('reordered-children');
			expect(s.plots.filter((p) => p.facetParent != null).map((p) => p.facetKey)).toEqual([
				'49:0:377',
				'49:1:375',
				'49:2:376'
			]);
			const out = migrateFacetChildren(s, { childDefaults: hook });
			// Keyed on the column, not the shifted index.
			expect(out.mapping.map((m) => m.unitKey)).toEqual(['y377#0', 'y375#0', 'y376#0']);
			// The fixture-2 edits were lost by the reorder at v76.4 (children destroyed), so nothing carries.
			expect(out.json.plots.find((p) => p.id === 49)).not.toHaveProperty('facetOverrides');
			expect(out.warnings).toEqual([]);
			expectMigratedShape(out);
		}
	);
});
