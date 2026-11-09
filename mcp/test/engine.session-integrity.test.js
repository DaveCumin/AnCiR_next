// Engine bugs found building ~30 sessions with the headless engine (2026-11-09):
//   1. importColumns took ids from a session-local counter that analysis outputs never advanced,
//      so data imported after an analysis reused an output's id and later analyses read the
//      wrong column (a GroupComparison on such a column came back invalid).
//   2. A second AncirSession silently emptied the first (the store is a singleton), and output
//      names (`mesor_<n>`) carried counters from sessions built earlier in the process.
//   3. RhythmicityAnalysis headless had no `stat_*` peak outputs, which the app's node adds.
//   4. A select param with a value the node does not offer (`analysis: "Periodogram"`) ran to
//      no outputs; a misspelt plot or analysis input field was ignored.
//   5. A cwt refused {time, values}, which a periodogram takes (and the reverse for {x, y}).
import { beforeAll, describe, expect, it } from 'vitest';
import { AncirSession, ensureRegistry, describeCapabilities } from '../src/engine/session.js';
import { selectOptionsFromSource } from '../src/engine/paramOptions.js';

const seq = (n, f) => Array.from({ length: n }, (_, i) => f(i));
const T = seq(96, (i) => i);
const A = T.map((i) => 5 + 2 * Math.cos((2 * Math.PI * i) / 24));

beforeAll(async () => {
	await ensureRegistry();
});

async function cosinorSession(id) {
	const s = new AncirSession(id);
	s.importColumns([
		{ name: 't', values: T },
		{ name: 'a', values: A }
	]);
	const fit = await s.runTableProcess('Cosinor', {
		xIN: 't',
		yIN: ['a'],
		useFixedPeriod: true,
		fixedPeriod: 24
	});
	expect(fit.valid).toBe(true);
	return { s, fit };
}

describe('1. column ids are unique across imports and analysis outputs', () => {
	it('a column imported after an analysis gets a fresh id', async () => {
		const { s, fit } = await cosinorSession('ids');
		const outIds = fit.outputs.map((o) => o.columnId);
		const [b] = s.importColumns([{ name: 'b', values: [1, 2, 3] }]);
		expect(outIds).not.toContain(b.id);
		const ids = s.listColumns().map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
		expect(s.getColumnData(b.id)).toEqual([1, 2, 3]);
	});

	it('an analysis on data imported after another analysis reads that data', async () => {
		const { s } = await cosinorSession('ids-group');
		s.importColumns([
			{ name: 'v', values: [1, 2, 3, 4, 5, 6, 7, 9] },
			{ name: 'g', values: [0, 0, 0, 0, 1, 1, 1, 1] }
		]);
		const res = await s.runTableProcess('GroupComparison', { xIN: 'g', yIN: ['v'] });
		expect(res.valid).toBe(true);
		const groups = Object.values(res.stats.comparisons)[0].groups.map((g) => g.name);
		expect(groups).toEqual(['0', '1']);
	});

	it('the exported session holds each id once', async () => {
		const { s } = await cosinorSession('ids-export');
		s.importColumns([{ name: 'b', values: [1, 2, 3] }]);
		const ids = s.exportSessionObject().data.map((c) => c.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe('2. one session per process, deterministic from a fresh start', () => {
	it('a superseded session refuses use instead of returning the newer session', async () => {
		const a = new AncirSession('A');
		a.importColumns([{ name: 'onlyA', values: [1] }]);
		const b = new AncirSession('B');
		b.importColumns([{ name: 'onlyB', values: [2] }]);
		expect(() => a.listColumns()).toThrow(/session "A" was superseded by session "B"/);
		expect(() => a.exportSession()).toThrow(/superseded/);
		expect(() => a.importColumns([{ name: 'x', values: [1] }])).toThrow(/superseded/);
		expect(() => a.addPlot('scatterplot', { x: 0, y: 0 })).toThrow(/superseded/);
		await expect(a.runTableProcess('Cosinor', {})).rejects.toThrow(/superseded/);
		expect(b.listColumns().map((c) => c.name)).toEqual(['onlyB']);
	});

	it('the same build in a fresh session gives the same ids and output names', async () => {
		const first = await cosinorSession('det-1');
		first.s.addPlot('scatterplot', { x: 't', y: 'a' });
		const json1 = first.s.exportSessionObject();
		const second = await cosinorSession('det-2');
		second.s.addPlot('scatterplot', { x: 't', y: 'a' });
		const json2 = second.s.exportSessionObject();
		const names = (r) => r.outputs.map((o) => [o.columnId, o.name]);
		expect(names(second.fit)).toEqual(names(first.fit));
		expect(second.fit.outputs.find((o) => o.key === 'mesor').name).toBe('mesor_0');
		expect(json2.data.map((c) => [c.id, c.name])).toEqual(json1.data.map((c) => [c.id, c.name]));
		expect(json2.plots.map((p) => p.id)).toEqual(json1.plots.map((p) => p.id));
	});
});

describe('3. RhythmicityAnalysis emits the peak statistics the node adds', () => {
	const run = async (args) => {
		const s = new AncirSession('rhythm-stats');
		s.importColumns([
			{ name: 't', values: T },
			{ name: 'a', values: A },
			{ name: 'b', values: T.map((i) => Math.sin((2 * Math.PI * i) / 24)) }
		]);
		return s.runTableProcess('RhythmicityAnalysis', { xIN: 't', yIN: ['a', 'b'], ...args });
	};
	const byKey = (res) => Object.fromEntries(res.outputs.map((o) => [o.key, o]));

	it('periodogram: stat_peak_period / power / pvalue, one value per y', async () => {
		const res = await run({ analysis: 'periodogram' });
		expect(res.valid).toBe(true);
		const out = byKey(res);
		for (const k of ['stat_peak_period', 'stat_peak_power', 'stat_peak_pvalue']) {
			expect(out[k], k).toBeTruthy();
			expect(out[k].length).toBe(2);
		}
		expect(out.stat_peak_period.preview[0]).toBeCloseTo(24, 0);
		expect(out.stat_peak_period.preview[1]).toBeCloseTo(24, 0);
	});

	it('periodogram (Enright): no peak p-value, as the node', async () => {
		const res = await run({ analysis: 'periodogram', pgMethod: 'Enright' });
		const keys = res.outputs.map((o) => o.key).filter((k) => k.startsWith('stat_'));
		expect(keys.sort()).toEqual(['stat_peak_period', 'stat_peak_power']);
	});

	it('correlogram: stat_peak_lag and stat_peak_correlation', async () => {
		const res = await run({ analysis: 'correlogram' });
		const out = byKey(res);
		expect(out.stat_peak_lag.preview[0]).toBeCloseTo(24, 0);
		expect(out.stat_peak_correlation.length).toBe(2);
	});

	it('fft: stat_peak_period, stat_peak_frequency and stat_peak_magnitude', async () => {
		const res = await run({ analysis: 'fft' });
		const keys = res.outputs.map((o) => o.key).filter((k) => k.startsWith('stat_'));
		expect(keys.sort()).toEqual(['stat_peak_frequency', 'stat_peak_magnitude', 'stat_peak_period']);
	});
});

describe('4. option values and input field names are validated', () => {
	const fresh = () => {
		const s = new AncirSession('validate');
		s.importColumns([
			{ name: 't', values: T },
			{ name: 'a', values: A }
		]);
		return s;
	};

	it('a select value the node does not offer is refused, listing the allowed values', async () => {
		const s = fresh();
		await expect(
			s.runTableProcess('RhythmicityAnalysis', { xIN: 't', yIN: ['a'], analysis: 'Periodogram' })
		).rejects.toThrow(
			/"analysis" must be one of "periodogram", "fft", "correlogram"; got "Periodogram"\. Did you mean "periodogram"\?/
		);
		await expect(
			s.runTableProcess('GroupComparison', { xIN: 't', yIN: ['a'], method: 't-test' })
		).rejects.toThrow(/"method" must be one of "auto", "ttest", "anova", "mannwhitney", "kruskal"/);
		// Nothing was added to the session by the refused calls.
		expect(s.exportSessionObject().tableProcesses).toEqual([]);
	});

	it('legal values still run, and an omitted select takes its default', async () => {
		const s = fresh();
		const ok = await s.runTableProcess('RhythmicityAnalysis', {
			xIN: 't',
			yIN: ['a'],
			analysis: 'correlogram'
		});
		expect(ok.valid).toBe(true);
		const dflt = await s.runTableProcess('RhythmicityAnalysis', { xIN: 't', yIN: ['a'] });
		expect(dflt.valid).toBe(true);
	});

	it('a column transform select is checked too', () => {
		const s = fresh();
		expect(() => s.addColumnProcess('a', 'OutlierRemoval', { method: 'IQR' })).toThrow(
			/"method" must be one of "iqr", "zscore"; got "IQR"/
		);
	});

	it('an analysis input field the node does not have is refused, naming its fields', async () => {
		const s = fresh();
		await expect(
			s.runTableProcess('GroupComparison', { valueIN: 'a', groupIN: 't' })
		).rejects.toThrow(
			/GroupComparison has no input "valueIN", "groupIN"\. Its input fields are xIN, yIN/
		);
	});

	it('a plot input field the plot does not have is refused, naming its inputs', () => {
		const s = fresh();
		expect(() => s.addPlot('scatterplot', { X: 't', y: 'a' })).toThrow(
			/Plot "scatterplot" has no input "X"\. Its inputs are x, y/
		);
		expect(() => s.addPlot('histogram', { values: 'a' })).toThrow(/has no input "values"/);
		expect(s.exportSessionObject().plots).toEqual([]);
	});

	it('reads AttributeSelect lists, imported constants and plain <select> options', async () => {
		const src = `
			<AttributeSelect bind:value={p.args.mode} options={['a', 'b']} />
			<select bind:value={p.args.kind}><option value="x">X</option><option value="y">Y</option></select>
			<select bind:value={p.args.dyn}>{#each opts as o}<option value={o}>{o}</option>{/each}</select>
			<select bind:value={p.args.alpha}><option value={0.05}>0.05</option></select>
			<AttributeSelect bind:value={localState} options={['q']} />`;
		const o = await selectOptionsFromSource(src);
		expect(o.get('mode')).toEqual(['a', 'b']);
		expect(o.get('kind')).toEqual(['x', 'y']);
		expect(o.get('dyn')).toBeNull();
		expect(o.get('alpha')).toBeNull();
		expect(o.has('localState')).toBe(false);
	});
});

describe('5. two-input plots take either {x, y} or {time, values}', () => {
	const fresh = () => {
		const s = new AncirSession('plot-alias');
		s.importColumns([
			{ name: 't', values: T },
			{ name: 'a', values: A }
		]);
		return s;
	};

	for (const type of ['cwt', 'periodogram', 'correlogram', 'scatterplot', 'actogram']) {
		for (const inputs of [
			{ x: 't', y: 'a' },
			{ time: 't', values: 'a' }
		]) {
			it(`${type} wires ${JSON.stringify(inputs)}`, () => {
				const s = fresh();
				const r = s.addPlot(type, inputs);
				const series = s.exportSessionObject().plots.find((p) => p.id === r.plotId).plot.data[0];
				expect(series.x.refId).toBe(0);
				expect(series.y.refId).toBe(1);
			});
		}
	}

	it('one input given under both names is refused', () => {
		const s = fresh();
		expect(() => s.addPlot('cwt', { x: 't', time: 't', y: 'a' })).toThrow(/given twice/);
	});

	it('list_capabilities advertises the other names', () => {
		const cwt = describeCapabilities().plots.find((p) => p.id === 'cwt');
		expect(cwt.inputs).toEqual(['x', 'y']);
		expect(cwt.inputAliases).toEqual({ time: 'x', values: 'y' });
	});
});

describe('6. an invalid analysis says why', () => {
	it('GroupComparison with one group names the reason', async () => {
		const s = new AncirSession('why');
		s.importColumns([
			{ name: 'v', values: [1, 2, 3, 4] },
			{ name: 'g', values: [0, 0, 0, 0] }
		]);
		const res = await s.runTableProcess('GroupComparison', { xIN: 'g', yIN: ['v'] });
		expect(res.valid).toBe(false);
		expect(res.error).toMatch(/v: Need at least 2 groups with data for comparison/);
	});
});
