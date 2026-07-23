import { describe, it, expect, beforeEach } from 'vitest';
import { core } from './core.svelte.js';
import {
	tpStatus,
	plotStatus,
	plotSeriesCounts,
	anyPlotStatus,
	cosinorFitStatus,
	wiringHint,
	binnedOutElForAxis,
	cosinorOutElForAxis,
	sourceOutElForAxis,
	firstSourceOutEl
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

describe('plotSeriesCounts — how many series carry x / y (multi-series steps)', () => {
	it('counts x- and y-filled series independently', () => {
		core.plots = [
			plot('scatterplot', [series(1, 2), { x: { refId: 3 }, y: { refId: -1 } }])
		];
		expect(plotSeriesCounts('scatterplot')).toEqual({ withX: 2, withY: 1 });
	});
	it('is zero for an unwired plot', () => {
		core.plots = [plot('scatterplot', [])];
		expect(plotSeriesCounts('scatterplot')).toEqual({ withX: 0, withY: 0 });
	});
});

describe('binned/cosinor output resolvers — map semantic key → col_<colId> dot', () => {
	// A TP output dot's DOM port name is `col_<colId>`; args.out maps the semantic
	// key to that colId. The resolvers must follow that indirection.
	const addOutDot = (nodeId, colId) => {
		const el = document.createElement('button');
		el.setAttribute('data-node-id', nodeId);
		el.setAttribute('data-port-name', `col_${colId}`);
		el.setAttribute('data-port-dir', 'out');
		document.body.appendChild(el);
		return el;
	};
	beforeEach(() => {
		document.body.innerHTML = '';
	});

	it('finds the Bin Data binnedx / first binnedy_* output dots', () => {
		core.tableProcesses = [
			{ name: 'BinnedData', id: 7, args: { out: { binnedx: 42, binnedy_5: 99 } } }
		];
		const xDot = addOutDot('tableprocess_7', 42);
		const yDot = addOutDot('tableprocess_7', 99);
		expect(binnedOutElForAxis('x')).toBe(xDot);
		expect(binnedOutElForAxis('y')).toBe(yDot);
	});

	it('finds the Cosinor cosinorx / first cosinory_* output dots', () => {
		core.tableProcesses = [
			{ name: 'Cosinor', id: 3, args: { out: { cosinorx: 11, cosinory_8: 12 } } }
		];
		const xDot = addOutDot('tableprocess_3', 11);
		const yDot = addOutDot('tableprocess_3', 12);
		expect(cosinorOutElForAxis('x')).toBe(xDot);
		expect(cosinorOutElForAxis('y')).toBe(yDot);
	});

	it('returns null when the output is not yet produced (colId < 0)', () => {
		core.tableProcesses = [{ name: 'Cosinor', id: 3, args: { out: { cosinorx: -1 } } }];
		expect(cosinorOutElForAxis('x')).toBe(null);
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


describe('sourceOutElForAxis — pick the demo-edge source by column TYPE, not DOM order', () => {
	// Reproduces the bug behind the wrong y-axis highlight: once a plot is wired it sprouts its
	// OWN output dot (on a plot_* node) that lands FIRST in document order, shifting a positional
	// pick off the data column and onto the time column. The fix restricts to data-source nodes
	// and picks by the column's type.
	const dot = (nodeId, colId, dir = 'out') => {
		const el = document.createElement('button');
		el.setAttribute('data-port-dir', dir);
		el.setAttribute('data-node-id', nodeId);
		el.setAttribute('data-port-name', `col_${colId}`);
		el.dataset.testTag = `${nodeId}:${colId}`;
		document.body.appendChild(el);
		return el;
	};

	beforeEach(() => {
		document.body.innerHTML = '';
		// id 0 = time column, id 1 = value column — the shape of the imported Test data.
		core.data = [
			{ id: 0, type: 'time', name: 'Time' },
			{ id: 1, type: 'number', name: 'Activity' }
		];
	});

	it('picks the time column for x and the value column for y', () => {
		dot('group_1', 0); // Time
		dot('group_1', 1); // Activity
		expect(sourceOutElForAxis('x').dataset.testTag).toBe('group_1:0');
		expect(sourceOutElForAxis('y').dataset.testTag).toBe('group_1:1');
	});

	it('ignores a plot\'s own output dot, even when it sorts first in the DOM', () => {
		// The phantom: a wired actogram exposes col_0 on plot_0, added to the DOM BEFORE the group.
		dot('plot_0', 0);
		dot('group_1', 0); // Time
		dot('group_1', 1); // Activity
		// Positional code returned dots[1] = the phantom-shifted TIME port; type-aware returns value.
		expect(sourceOutElForAxis('y').dataset.testTag).toBe('group_1:1');
		expect(sourceOutElForAxis('x').dataset.testTag).toBe('group_1:0');
		expect(firstSourceOutEl().getAttribute('data-node-id')).toBe('group_1');
	});

	it('picks by type regardless of the source columns\' order', () => {
		// Value first, time second — the type check must still route each axis correctly.
		core.data = [
			{ id: 5, type: 'number', name: 'Activity' },
			{ id: 6, type: 'time', name: 'Time' }
		];
		dot('group_2', 5); // Activity
		dot('group_2', 6); // Time
		expect(sourceOutElForAxis('x').dataset.testTag).toBe('group_2:6');
		expect(sourceOutElForAxis('y').dataset.testTag).toBe('group_2:5');
	});

	it('falls back to positional order when no column is typed time', () => {
		core.data = [
			{ id: 0, type: 'number', name: 'a' },
			{ id: 1, type: 'number', name: 'b' }
		];
		dot('group_1', 0);
		dot('group_1', 1);
		expect(sourceOutElForAxis('x').dataset.testTag).toBe('group_1:0');
		expect(sourceOutElForAxis('y').dataset.testTag).toBe('group_1:1');
	});
});
