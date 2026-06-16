import { describe, it, expect, beforeEach } from 'vitest';
import { core } from './core.svelte.js';
import {
	tpStatus,
	plotStatus,
	anyPlotStatus,
	cosinorFitStatus,
	wiringHint
} from './tourWiring.js';

const series = (x, y) => ({ x: { refId: x }, y: { refId: y } });
const plot = (type, data) => ({ type, plot: { data } });

beforeEach(() => {
	core.plots = [];
	core.tableProcesses = [];
});

describe('tpStatus — a table process needs BOTH x and ≥1 y', () => {
	it('is not done with nothing wired', () => {
		core.tableProcesses = [{ name: 'BinnedData', args: { xIN: -1, yIN: [] } }];
		expect(tpStatus('BinnedData')).toEqual({ xOk: false, yOk: false, done: false });
	});
	it('is not done with only x wired', () => {
		core.tableProcesses = [{ name: 'BinnedData', args: { xIN: 3, yIN: [] } }];
		const s = tpStatus('BinnedData');
		expect(s.xOk).toBe(true);
		expect(s.yOk).toBe(false);
		expect(s.done).toBe(false);
	});
	it('is done once x and a y are both wired', () => {
		core.tableProcesses = [{ name: 'BinnedData', args: { xIN: 3, yIN: [5] } }];
		expect(tpStatus('BinnedData').done).toBe(true);
	});
});

describe('plotStatus — a plot needs BOTH x and y on one series', () => {
	it('is not done with only one wire', () => {
		core.plots = [plot('actogram', [series(2, -1)])];
		const s = plotStatus('actogram');
		expect(s.xOk).toBe(true);
		expect(s.yOk).toBe(false);
		expect(s.done).toBe(false);
	});
	it('is done when one series has both x and y', () => {
		core.plots = [plot('actogram', [series(2, 4)])];
		expect(plotStatus('actogram').done).toBe(true);
	});
	it('x and y on DIFFERENT series does not count as done', () => {
		core.plots = [plot('actogram', [series(2, -1), series(-1, 4)])];
		const s = plotStatus('actogram');
		expect(s.xOk).toBe(true);
		expect(s.yOk).toBe(true);
		expect(s.done).toBe(false);
	});
	it('reads the most-recently-added plot of the type', () => {
		core.plots = [plot('actogram', [series(2, 4)]), plot('actogram', [series(-1, -1)])];
		expect(plotStatus('actogram').done).toBe(false);
	});
});

describe('anyPlotStatus — type-agnostic completeness', () => {
	it('done when any plot has a fully-wired series', () => {
		core.plots = [plot('histogram', [series(-1, -1)]), plot('scatterplot', [series(1, 2)])];
		expect(anyPlotStatus().done).toBe(true);
	});
	it('columnRefs ≥ 2 counts as wired', () => {
		core.plots = [{ type: 'boxplot', plot: { data: [], columnRefs: [1, 2] } }];
		expect(anyPlotStatus().done).toBe(true);
	});
	it('not done with only partial wiring', () => {
		core.plots = [plot('scatterplot', [series(1, -1)])];
		expect(anyPlotStatus().done).toBe(false);
	});
});

describe('cosinorFitStatus — the fitted curve must be plotted', () => {
	const cosinor = (out) => ({ name: 'Cosinor', args: { out } });
	it('is not done before the fit is plotted', () => {
		core.tableProcesses = [cosinor({ cosinorx: 10, cosinory_5: 11 })];
		core.plots = [plot('scatterplot', [series(0, 1)])];
		expect(cosinorFitStatus().done).toBe(false);
	});
	it('is not done with only cosinorx on x (no cosinory on y)', () => {
		core.tableProcesses = [cosinor({ cosinorx: 10, cosinory_5: 11 })];
		core.plots = [plot('scatterplot', [series(10, 1)])];
		const s = cosinorFitStatus();
		expect(s.xOk).toBe(true);
		expect(s.yOk).toBe(false);
		expect(s.done).toBe(false);
	});
	it('is done when one series has cosinorx → x and a cosinory → y', () => {
		core.tableProcesses = [cosinor({ cosinorx: 10, cosinory_5: 11 })];
		core.plots = [plot('scatterplot', [series(10, 11)])];
		expect(cosinorFitStatus().done).toBe(true);
	});
	it('ignores scalar outputs (period/amplitude) wired by accident', () => {
		core.tableProcesses = [cosinor({ cosinorx: 10, cosinory_5: 11, period: 12, amplitude: 13 })];
		core.plots = [plot('scatterplot', [series(12, 13)])];
		expect(cosinorFitStatus().done).toBe(false);
	});
});

describe('wiringHint — live nudge for what is still missing', () => {
	const st = (xOk, yOk) => ({ xOk, yOk, done: xOk && yOk });
	it('asks for both when nothing is wired', () => {
		const h = wiringHint('intro', 'time', 'xIN', 'activity', 'yIN', st(false, false));
		expect(h).toContain('Drag both wires');
		expect(h).toContain('⬜️ time → <strong>xIN</strong>');
	});
	it('nudges the remaining input when one is done', () => {
		const h = wiringHint('intro', 'time', 'xIN', 'activity', 'yIN', st(true, false));
		expect(h).toContain('✅ time → <strong>xIN</strong>');
		expect(h).toContain('now wire activity → <strong>yIN</strong>');
	});
	it('confirms when both are wired', () => {
		const h = wiringHint('intro', 'time', 'xIN', 'activity', 'yIN', st(true, true));
		expect(h).toContain('Both connected');
	});
	it('appends an optional tip', () => {
		const h = wiringHint('intro', 'a', 'x', 'b', 'y', st(false, false), 'extra tip');
		expect(h).toContain('class="tour-tip"');
		expect(h).toContain('extra tip');
	});
});
