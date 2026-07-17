import { describe, it, expect, beforeEach } from 'vitest';
import { core, appConsts } from '$lib/core/core.svelte.js';
import { loadTableProcesses } from '$lib/tableProcesses/tableProcessMap.js';
import { canonicalNodeViz, plotDataFromSpec } from './canonicalNodeViz.js';

beforeEach(async () => {
	core.data = [];
	core.rawData = new Map();
	appConsts.tableProcessMap = await loadTableProcesses();
});

// Minimal fake nodes (the shape WorkflowEditor's allNodes exposes). `args` is passed through
// whole rather than picked apart, so node-specific params (e.g. RhythmicityAnalysis's
// `analysis` mode, which selects its output pair) actually reach the code under test.
function fitNode(name, args) {
	return { id: `tableprocess_1`, type: 'tableprocess', tpObj: { id: 1, name, args } };
}

describe('canonicalNodeViz', () => {
	it('fit TP (Cosinor) → data+fit scatter: raw points + fitted line per Y', () => {
		// Cosinor declares xOutKey:'cosinorx', yOutKeyPrefix:'cosinory_'.
		const node = fitNode('Cosinor', {
			xIN: 10,
			yIN: [20],
			out: { cosinorx: 30, cosinory_20: 40, period: 50 }
		});
		const spec = canonicalNodeViz(node);
		expect(spec.type).toBe('scatterplot');
		// series[0] = raw (points, x=10,y=20); series[1] = fit (line, x=30,y=40)
		expect(spec.series[0]).toMatchObject({ x: 10, y: 20, kind: 'points' });
		expect(spec.series[1]).toMatchObject({ x: 30, y: 40, kind: 'line' });
	});

	it('GroupComparison → boxplot with sig bars', () => {
		const node = fitNode('GroupComparison', { xIN: 11, yIN: [22], out: {} });
		const spec = canonicalNodeViz(node);
		expect(spec).toMatchObject({ type: 'boxplot', box: { x: 11, y: 22 }, showSigBars: true });
	});

	it('RayleighTest → circular phase plot: one series per Y, time from timeIN', () => {
		const node = { id: 'tableprocess_2', type: 'tableprocess', tpObj: { id: 2, name: 'RayleighTest', args: { timeIN: 7, yIN: [21, 22], out: {} } } };
		const spec = canonicalNodeViz(node);
		expect(spec.type).toBe('circularphase');
		expect(spec.series).toEqual([
			{ x: 7, y: 21, label: expect.any(String) },
			{ x: 7, y: 22, label: expect.any(String) }
		]);
	});

	it('RayleighTest with no timeIN → circular series with x = -1', () => {
		const node = { id: 'tableprocess_3', type: 'tableprocess', tpObj: { id: 3, name: 'RayleighTest', args: { timeIN: -1, yIN: [21], out: {} } } };
		expect(canonicalNodeViz(node).series[0]).toMatchObject({ x: -1, y: 21 });
	});

	it('other TP → tableplot fallback of inputs + numeric outputs', () => {
		// MovingAnalysis has no xOutKey/yOutKeyPrefix (not a fit node), so it
		// should fall through to the generic tableplot fallback.
		const node = fitNode('MovingAnalysis', { xIN: 1, yIN: [2], out: { a: 3, b: 4 } });
		const spec = canonicalNodeViz(node);
		expect(spec.type).toBe('tableplot');
		expect(spec.columnRefs).toEqual(expect.arrayContaining([1, 2, 3, 4]));
	});

	it('returns null for a plot node', () => {
		expect(canonicalNodeViz({ id: 'plot_1', type: 'plot', plotObj: {} })).toBeNull();
	});

	// ---- nodes whose output X is NOT the input's axis ----
	// These used to take the generic fit branch, which overlays the raw series on the output.
	// That only makes sense when the output X is the same quantity as the input X. For these
	// three it isn't, so the raw series has to go. Domains observed in the shipped demos:
	//   AverageProfile   raw x [0..95]  vs avgprofx [0.5..23.5]   (folded onto one day)
	//   NonparametricRA  raw x [0..335] vs npcrax   [0.5..23.5]   (folded onto one day)
	//   Rhythmicity      raw x = time   vs period / lag           (a different quantity entirely)

	it('RhythmicityAnalysis → its own period/power outputs, NOT the raw input series', () => {
		// Standalone nodes emit per-Y `<yId>_<key>` columns (see syncOutputColumns); the
		// registry's rhythmicityx/rhythmicityy_ pair exists ONLY in collected/L2W mode. The fit
		// branch looked for the collected keys, missed, dropped the fit line, and emitted the
		// raw data alone under a "data + fit" title — the reported bug.
		const node = fitNode('RhythmicityAnalysis', {
			analysis: 'periodogram', // the node's default; a real node always carries it
			xIN: 313,
			yIN: [314],
			out: { '314_period': 315, '314_power': 316, stat_peak_period: 318, stat_peak_power: 319 }
		});
		const spec = canonicalNodeViz(node);
		expect(spec.type).toBe('scatterplot');
		expect(spec.series).toHaveLength(1);
		expect(spec.series[0]).toMatchObject({ x: 315, y: 316, kind: 'line' }); // period vs power
		// The raw input series must not appear: its x is time, not period.
		expect(spec.series.some((s) => s.x === 313 || s.y === 314)).toBe(false);
		expect(spec.title).toContain('power');
		expect(spec.title).toContain('period');
	});

	it('RhythmicityAnalysis follows the analysis mode (correlogram → lag vs correlation)', () => {
		const node = {
			id: 'tableprocess_4',
			type: 'tableprocess',
			tpObj: {
				id: 4,
				name: 'RhythmicityAnalysis',
				args: {
					analysis: 'correlogram',
					xIN: 1,
					yIN: [2],
					out: { '2_lag': 5, '2_correlation': 6 }
				}
			}
		};
		const spec = canonicalNodeViz(node);
		expect(spec.series[0]).toMatchObject({ x: 5, y: 6, kind: 'line' });
		expect(spec.title).toContain('lag');
	});

	it('RhythmicityAnalysis with one output column per Y, for several Ys', () => {
		const node = fitNode('RhythmicityAnalysis', {
			analysis: 'periodogram',
			xIN: 1,
			yIN: [2, 3],
			out: { '2_period': 10, '2_power': 11, '3_period': 12, '3_power': 13 }
		});
		const spec = canonicalNodeViz(node);
		expect(spec.series).toHaveLength(2);
		expect(spec.series[0]).toMatchObject({ x: 10, y: 11 });
		expect(spec.series[1]).toMatchObject({ x: 12, y: 13 });
	});

	it('RhythmicityAnalysis with no computed outputs → tableplot, not an empty scatter', () => {
		const node = fitNode('RhythmicityAnalysis', { analysis: 'periodogram', xIN: 1, yIN: [2], out: {} });
		expect(canonicalNodeViz(node).type).toBe('tableplot');
	});

	it('RhythmicityAnalysis in an unknown mode → tableplot, never the raw input series', () => {
		// No primary key pair for the mode means we cannot know which output is the X. Show the
		// columns rather than guess — and crucially, never fall back to plotting raw time data,
		// which is what made the original bug look like a working plot.
		const node = fitNode('RhythmicityAnalysis', {
			analysis: 'somethingNew',
			xIN: 1,
			yIN: [2],
			out: { '2_period': 10, '2_power': 11 }
		});
		expect(canonicalNodeViz(node).type).toBe('tableplot');
	});

	it('AverageProfile → the profile alone, without the unfolded raw series over it', () => {
		const node = fitNode('AverageProfile', {
			xIN: 370,
			yIN: [371],
			out: { avgprofx: 372, avgprof_371: 373, avgprofsem_371: 374 }
		});
		const spec = canonicalNodeViz(node);
		expect(spec.type).toBe('scatterplot');
		expect(spec.series).toHaveLength(1);
		expect(spec.series[0]).toMatchObject({ x: 372, y: 373, kind: 'line' });
		expect(spec.series.some((s) => s.x === 370)).toBe(false); // raw x [0..95] must not join
		expect(spec.title).not.toContain('fit'); // a folded profile is not a fit of the data
	});

	it('NonparametricRA → the average-day profile alone', () => {
		const node = fitNode('NonparametricRA', {
			xIN: 322,
			yIN: [323],
			out: { npcrax: 324, npcray_323: 325, IS: 326, IV: 327 }
		});
		const spec = canonicalNodeViz(node);
		expect(spec.series).toHaveLength(1);
		expect(spec.series[0]).toMatchObject({ x: 324, y: 325, kind: 'line' });
		expect(spec.series.some((s) => s.x === 322)).toBe(false);
	});

	it('AverageProfile with no computed profile → tableplot, not an empty scatter', () => {
		const node = fitNode('AverageProfile', { xIN: 1, yIN: [2], out: {} });
		expect(canonicalNodeViz(node).type).toBe('tableplot');
	});

	it('the same-axis fit nodes still overlay raw + fit', () => {
		// Guard the 8 nodes whose output X genuinely IS the input axis — the fix must not
		// strip their raw series (verified against the demos: BinnedData, Cosinor,
		// DoubleLogistic, FitFunction, Interpolate, RectangularWave, SmoothedData, TrendFit).
		for (const [name, xKey, yKey] of [
			['BinnedData', 'binnedx', 'binnedy_20'],
			['SmoothedData', 'smoothedx', 'smoothedy_20'],
			['TrendFit', 'trendx', 'trendy_20'],
			['Interpolate', 'interpx', 'interpy_20']
		]) {
			const node = fitNode(name, { xIN: 10, yIN: [20], out: { [xKey]: 30, [yKey]: 40 } });
			const spec = canonicalNodeViz(node);
			expect(spec.series, name).toHaveLength(2);
			expect(spec.series[0], name).toMatchObject({ x: 10, y: 20, kind: 'points' });
			expect(spec.series[1], name).toMatchObject({ x: 30, y: 40, kind: 'line' });
		}
	});

	it('fit TP with no x wired → falls back to tableplot (no broken scatter)', () => {
		const node = { id: 'tableprocess_9', type: 'tableprocess', tpObj: { id: 9, name: 'Cosinor', args: { xIN: -1, yIN: [20], out: { cosinory_20: 40, period: 50 } } } };
		const spec = canonicalNodeViz(node);
		expect(spec.type).toBe('tableplot');
	});
});

describe('plotDataFromSpec', () => {
	it('scatterplot spec → addPlot payload with refId-wired series + sourceNodeId', () => {
		const spec = {
			type: 'scatterplot',
			title: 'Cosinor: data + fit',
			series: [
				{ x: 10, y: 20, label: 'y', kind: 'points', colour: '#234154' },
				{ x: 30, y: 40, label: 'y fit', kind: 'line', colour: '#BE796B' }
			]
		};
		const pd = plotDataFromSpec(spec, { x: 800, y: 60, sourceNodeId: 'tableprocess_1' });
		expect(pd).toMatchObject({ name: 'Cosinor: data + fit', type: 'scatterplot', x: 800, y: 60, sourceNodeId: 'tableprocess_1' });
		expect(pd.plot.data[0]).toMatchObject({ x: { refId: 10 }, y: { refId: 20 } });
		expect(pd.plot.data[1].line.draw).toBe(true);   // fit series is a line
		expect(pd.plot.data[0].points.draw).toBe(true); // raw series is points
	});

	it('boxplot + tableplot specs → correct inner shapes', () => {
		const box = plotDataFromSpec({ type: 'boxplot', title: 't', box: { x: 1, y: 2 }, showSigBars: true }, { x: 0, y: 0 });
		expect(box.plot).toMatchObject({ data: [{ x: { refId: 1 }, y: { refId: 2 } }], showSigBars: true });
		const tbl = plotDataFromSpec({ type: 'tableplot', title: 't', columnRefs: [1, 2, 3] }, { x: 0, y: 0 });
		expect(tbl.plot).toMatchObject({ columnRefs: [1, 2, 3], showCol: [true, true, true] });
	});

	it('circularphase spec → data series wired {x:time, y:phase}', () => {
		const cp = plotDataFromSpec(
			{ type: 'circularphase', title: 'c', series: [{ x: 7, y: 21, label: 'a' }, { x: -1, y: 22, label: 'b' }] },
			{ x: 0, y: 0 }
		);
		expect(cp.type).toBe('circularphase');
		expect(cp.plot.data).toEqual([
			{ x: { refId: 7 }, y: { refId: 21 }, label: 'a' },
			{ x: { refId: -1 }, y: { refId: 22 }, label: 'b' }
		]);
	});
});
