/**
 * Integration check: loading the testJSON from
 * https://raw.githubusercontent.com/DaveCumin/AnCiR_next/refs/heads/main/test/testJSON.json
 * into the Column / Scatterplot model — verifies that with the latest
 * `xOriginFor` fallback chain a mixed-mode scatter (1 time series + 2 number
 * series sharing the time origin) actually produces a finite xlims domain.
 *
 * Reduced shape so we can run without HTTP: the same column structure, but
 * with shorter rawData arrays to keep the test fast.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { fakeCore, fakeAppState, fakeAppConsts } = vi.hoisted(() => ({
	fakeCore: { data: [], rawData: new Map(), tables: [], plots: [] },
	fakeAppState: {
		displayTimezone: 'utc',
		AYStext: '',
		AYScallback: null,
		showAYSModal: false
	},
	fakeAppConsts: { processMap: new Map() }
}));

vi.mock('$lib/core/core.svelte.js', () => ({
	core: fakeCore,
	appConsts: fakeAppConsts,
	appState: fakeAppState,
	pushObj: (obj) => fakeCore.data.push(obj)
}));
vi.mock('$lib/core/core.svelte', () => ({
	core: fakeCore,
	appConsts: fakeAppConsts,
	appState: fakeAppState,
	pushObj: (obj) => fakeCore.data.push(obj)
}));
vi.mock('$lib/core/Process.svelte', () => ({
	Process: class {
		static fromJSON(json) {
			const p = new this();
			Object.assign(p, json);
			return p;
		}
		constructor() {
			this.id = Math.random();
			this.args = {};
		}
		doProcess(out) {
			return out;
		}
	},
	nextLinkedGroupId: () => 1,
	getLinkedProcesses: () => []
}));

// Minimal stubs for Scatterplot's heavyweight plotbit imports so the
// module can load in a test context without pulling in d3 + UI deps.
vi.mock('$lib/components/plotbits/Axis.svelte', () => ({
	default: {},
	AxisClass: class {
		constructor(json) {
			Object.assign(this, json ?? {});
		}
		toJSON() {
			return {};
		}
		static fromJSON(json) {
			return new this(json);
		}
	}
}));
vi.mock('$lib/components/plotbits/Line.svelte', () => ({
	default: {},
	LineClass: class {
		constructor(json, parent) {
			Object.assign(this, json ?? {});
			this.parentData = parent;
			this.draw = json?.draw ?? true;
		}
		toJSON() {
			return {};
		}
		static fromJSON(json) {
			return new this(json);
		}
	}
}));
vi.mock('$lib/components/plotbits/Points.svelte', () => ({
	default: {},
	PointsClass: class {
		constructor(json, parent) {
			Object.assign(this, json ?? {});
			this.parentData = parent;
			this.draw = json?.draw ?? true;
		}
		toJSON() {
			return {};
		}
		static fromJSON(json) {
			return new this(json);
		}
	}
}));
vi.mock('$lib/plots/Scatterplot/NightBand.svelte', () => ({
	default: {},
	NightBandClass: class {
		constructor(parent, json) {
			Object.assign(this, json ?? {});
		}
		toJSON() {
			return {};
		}
		static fromJSON(parent, json) {
			return new this(parent, json);
		}
	}
}));
vi.mock('$lib/components/plotbits/helpers/wrangleData.js', () => ({
	min: (a) => Math.min(...a),
	max: (a) => Math.max(...a)
}));
vi.mock('$lib/components/plotbits/helpers/tooltipHelpers.js', () => ({
	findNearestY: () => null,
	bindAltTooltipToggle: () => {}
}));
vi.mock('$lib/components/views/ControlDisplay.svelte', () => ({
	default: {},
	dataSettingsScrollTo: () => {}
}));

import { Column as ColumnClass } from '$lib/core/Column.svelte';
import { ScatterDataclass } from '$lib/plots/Scatterplot/Scatterplot.svelte';

beforeEach(() => {
	fakeCore.data.length = 0;
	fakeCore.rawData.clear();
});

describe('Loading a saved scatter with time + number series (testJSON shape)', () => {
	it('produces ms-typed wrapper data and a finite xlims-style range via xOriginFor fallback', () => {
		// Underlying columns, mirroring testJSON.data shape.
		const isoTimes = ['2020-01-01T00:00:00.000Z', '2020-01-01T01:00:00.000Z', '2020-01-01T02:00:00.000Z'];
		fakeCore.rawData.set(0, isoTimes);
		fakeCore.rawData.set(1, [10, 20, 30]);
		fakeCore.rawData.set(34, [0, 1, 2]); // hours-since-start (legacy cosinor x output)
		fakeCore.rawData.set(35, [11, 22, 33]);

		fakeCore.data.push(
			ColumnClass.fromJSON({
				id: 0,
				name: 'time_0',
				data: 0,
				type: 'time',
				timeFormat: "YYYY-MM-DD'T'HH:mm:ss.S'Z'"
			})
		);
		fakeCore.data.push(
			ColumnClass.fromJSON({ id: 1, name: 'values_0', data: 1, type: 'number' })
		);
		fakeCore.data.push(
			ColumnClass.fromJSON({ id: 34, name: 'cosinor_x', data: 34, type: 'number' })
		);
		fakeCore.data.push(
			ColumnClass.fromJSON({ id: 35, name: 'cosinor_y', data: 35, type: 'number' })
		);

		// The Scatterplot stores wrappers (refId-only) for each datum.
		const timeWrapper = ColumnClass.fromJSON({
			id: 100,
			name: 'time_0*',
			refId: 0,
			type: 'time',
			timeFormat: ''
		});
		const numXWrapper = ColumnClass.fromJSON({
			id: 101,
			name: 'cosinor_x*',
			refId: 34,
			type: 'number'
		});

		// 1) Wrapper of a time column must yield ms timestamps via getData().
		const tMs = timeWrapper.getData();
		expect(Array.isArray(tMs)).toBe(true);
		expect(tMs.length).toBe(3);
		expect(tMs[0]).toBe(Date.UTC(2020, 0, 1));
		expect(Number.isFinite(tMs[0])).toBe(true);

		// 2) Wrapper of a number column must yield raw numbers (no spurious origin).
		const numX = numXWrapper.getData();
		expect(numX).toEqual([0, 1, 2]);

		// 3) Wrapper of a number column must NOT report `originTime_ms === null`
		//    (regression guard for the literal-null Object.assign override that
		//    made `Number(null) === 0` lie in resolveXOriginMs).
		expect(numXWrapper.originTime_ms).not.toBe(null);

		// 4) Wrapper of a time column has no usable own origin; downstream code
		//    should fall back to the first-timestamp path.
		expect(timeWrapper.originTime_ms == null).toBe(true);

		// 5) Range simulation: with the time wrapper providing the reference and
		//    the number wrapper carried as hours-since-origin, the combined ms
		//    range should span at least the time series's first→last and reach
		//    further to cover the highest converted hour.
		const origin = tMs[0];
		const numAsMs = numX.map((h) => origin + h * 3_600_000);
		const xs = [...tMs, ...numAsMs];
		const lo = Math.min(...xs);
		const hi = Math.max(...xs);
		expect(Number.isFinite(lo)).toBe(true);
		expect(Number.isFinite(hi)).toBe(true);
		expect(hi).toBeGreaterThan(lo);
	});
});

describe('ScatterDataclass.fromJSON preserves serialised wrapper state', () => {
	it('keeps the saved wrapper id so downstream references stay stable', () => {
		fakeCore.rawData.set(0, [0, 1, 2]);
		fakeCore.data.push(
			ColumnClass.fromJSON({ id: 0, name: 'src', data: 0, type: 'number' })
		);

		const parent = { data: [] };
		const savedScatterData = {
			x: { id: 200, refId: 0, name: 'src*', type: 'number', processes: [] },
			y: { id: 201, refId: 0, name: 'src*', type: 'number', processes: [] },
			label: 'd1',
			yAxis: 'left',
			line: {},
			points: {}
		};

		const sd = ScatterDataclass.fromJSON(savedScatterData, parent);
		expect(sd.x.id).toBe(200);
		expect(sd.y.id).toBe(201);
	});

	it('keeps wrapper-column processes that were attached in the plot', () => {
		// Underlying source column the wrapper points at.
		fakeCore.rawData.set(0, [1, 2, 3, 4]);
		fakeCore.data.push(
			ColumnClass.fromJSON({ id: 0, name: 'src', data: 0, type: 'number' })
		);

		const parent = { data: [] };
		const savedScatterData = {
			x: {
				id: 300,
				refId: 0,
				name: 'src*',
				type: 'number',
				processes: [
					{ id: 9001, name: 'normalize', args: { mode: 'zscore' } }
				]
			},
			y: {
				id: 301,
				refId: 0,
				name: 'src*',
				type: 'number',
				processes: [
					{ id: 9002, name: 'normalize', args: { mode: 'minmax' } },
					{ id: 9003, name: 'detrend', args: {} }
				]
			},
			label: 'd1',
			yAxis: 'left',
			line: {},
			points: {}
		};

		const sd = ScatterDataclass.fromJSON(savedScatterData, parent);

		// Regression guard: 32.6 introduced a slim that stripped wrapper JSON
		// down to `{refId}`, silently dropping every saved process. Anything
		// the user attached to plot columns (filter, normalize, detrend, etc.)
		// vanished on reload.
		expect(sd.x.processes).toHaveLength(1);
		expect(sd.x.processes[0].name).toBe('normalize');
		expect(sd.x.processes[0].args).toEqual({ mode: 'zscore' });

		expect(sd.y.processes).toHaveLength(2);
		expect(sd.y.processes.map((p) => p.name)).toEqual(['normalize', 'detrend']);
		expect(sd.y.processes[0].args).toEqual({ mode: 'minmax' });
	});
});
