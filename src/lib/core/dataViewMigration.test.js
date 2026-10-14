// @ts-nocheck
// The pure Data View -> Table migration (plan 2026-10-15 "fold Data View into Table", 2.7 and
// 5.1). Fixtures: src/test/fixtures/dataview-legacy-handmade.json (hand-made) and
// dataview-v81.16-saved.json (the same session loaded and saved by v81.16); see the README there.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { migrateDataViews, migrateDataViewPlot, NODE_RESULT_TABLES } from './dataViewMigration.js';
import { permutationTableData } from '$lib/tableProcesses/permutationSupport.js';

const fixture = (name) =>
	JSON.parse(readFileSync(join(process.cwd(), 'src', 'test', 'fixtures', name), 'utf8'));
const FIXTURES = ['dataview-legacy-handmade.json', 'dataview-v81.16-saved.json'];

const tableBase = (decimalPlaces = 2) => ({
	columnRefs: [],
	showCol: [],
	colWidths: {},
	colCurrent: 1,
	showColNumber: false,
	decimalPlaces
});

// A session with one table process of `type` (id 9) and the given plots.
const session = (plots, type = 'Cosinor') => ({
	plots,
	tableProcesses: [{ id: 9, name: type, args: {} }]
});
const staticView = (headers, rows, extra = {}) => ({
	id: 30,
	name: 'A view',
	type: 'dataview',
	x: 1,
	y: 2,
	width: 300,
	height: 200,
	sourceNodeId: 'tableprocess_9',
	plot: {
		sourcePlotId: null,
		sourceType: 'static',
		staticHeaders: headers,
		staticRows: rows,
		decimalPlaces: 3
	},
	...extra
});

describe('migrateDataViews on the fixtures', () => {
	for (const name of FIXTURES) {
		it(`${name}: both views become Tables, everything else and the wrappers unchanged`, () => {
			const s = fixture(name);
			const before = JSON.stringify(s);
			const { json, warnings } = migrateDataViews(s);
			expect(JSON.stringify(s)).toBe(before); // input not mutated
			expect(warnings).toEqual([]);
			expect(json.plots.map((p) => `${p.id}:${p.type}`)).toEqual([
				'110:scatterplot',
				'111:tableplot',
				'120:tableplot',
				'121:tableplot'
			]);
			expect(JSON.stringify(json)).not.toContain('"dataview"');

			const reactive = json.plots.find((p) => p.id === 120);
			expect(reactive.plot).toEqual({ source: 'plot', sourcePlotId: 110, ...tableBase(2) });
			const stats = json.plots.find((p) => p.id === 121);
			expect(stats.sourceNodeId).toBe('tableprocess_57');
			expect(stats.plot).toEqual({
				source: 'node',
				resultKey: 'stats',
				snapshot: {
					headers: ['column', 'period', 'mesor', 'amplitude'],
					rows: [['activity', 24, 10.01, 2.98]]
				},
				...tableBase(2)
			});

			// The wrapper (id, name, position, size, style, links) is the saved one, only the
			// type and the inner differ; every other slice is identical.
			const wrapper = (p) => ({ ...p, type: undefined, plot: undefined });
			s.plots.forEach((p, i) => expect(wrapper(json.plots[i])).toEqual(wrapper(p)));
			for (const k of Object.keys(s)) if (k !== 'plots') expect(json[k]).toEqual(s[k]);
		});
	}

	it('is idempotent and returns the same object when there is nothing to do', () => {
		const once = migrateDataViews(fixture(FIXTURES[1])).json;
		const twice = migrateDataViews(once);
		expect(twice.json).toBe(once);
		expect(twice.warnings).toEqual([]);
		const none = { plots: [{ id: 1, type: 'scatterplot', plot: {} }] };
		expect(migrateDataViews(none).json).toBe(none);
		expect(migrateDataViews({}).json).toEqual({});
	});

	it('also rewrites a Data View waiting in unrestoredPlots', () => {
		const s = { plots: [], unrestoredPlots: [{ ...staticView(['column', 'r2'], []), id: 31 }] };
		s.tableProcesses = [{ id: 9, name: 'Cosinor' }];
		const { json } = migrateDataViews(s);
		expect(json.unrestoredPlots[0].type).toBe('tableplot');
		expect(json.unrestoredPlots[0].plot.resultKey).toBe('stats');
	});
});

describe('migrateDataViewPlot: reactive views', () => {
	it('keeps a facet panel id as the source and drops the saved copy of the rows', () => {
		const { plot, warning } = migrateDataViewPlot({
			id: 5,
			type: 'dataview',
			plot: {
				sourcePlotId: '7:c112#0',
				sourceType: 'reactive',
				staticHeaders: ['x'],
				staticRows: [[1]],
				decimalPlaces: 4
			}
		});
		expect(warning).toBeNull();
		expect(plot.plot).toEqual({ source: 'plot', sourcePlotId: '7:c112#0', ...tableBase(4) });
	});

	it('treats an absent sourceType as reactive (DataView.fromJSON did)', () => {
		const { plot } = migrateDataViewPlot({ id: 5, type: 'dataview', plot: { sourcePlotId: 3 } });
		expect(plot.plot).toEqual({ source: 'plot', sourcePlotId: 3, ...tableBase(2) });
	});

	it('leaves any other plot as the same object', () => {
		const p = { id: 1, type: 'tableplot', plot: { columnRefs: [3] } };
		expect(migrateDataViewPlot(p).plot).toBe(p);
	});
});

describe('migrateDataViewPlot: static views, by headers then title', () => {
	const PERM = permutationTableData([]).headers;
	const cases = [
		['Cosinor', ['column', 'rmse', 'r2', 'perm_p_value', 'mesor'], 'stats'],
		['Cosinor', PERM, 'permutations'],
		['DoubleLogistic', ['column', 'rmse', 'r2', 'period', 'onset'], 'stats'],
		['DoubleLogistic', PERM, 'permutations'],
		['RectangularWave', ['column', 'rmse', 'r2', 'period', 'duty_cycle'], 'stats'],
		['RectangularWave', PERM, 'permutations'],
		['FitFunction', ['column', 'rmse', 'r2', 'M', 'period', 'pValue'], 'stats'],
		['TrendFit', ['column', 'rmse', 'r2', 'slope', 'intercept'], 'stats'],
		['RhythmicityAnalysis', ['column', 'period', 'power'], 'stats'],
		['GroupComparison', ['column', 'test', 'group_count', 'n_total', 'p_value'], 'stats'],
		[
			'GroupComparison',
			['column', 'group', 'n', 'mean', 'sd', 'min', 'max', 'median', 'jb_p'],
			'summary'
		],
		[
			'GroupComparison',
			['column', 'family', 'group_a', 'group_b', 'difference_or_stat', 'p_adjusted'],
			'posthoc'
		]
	];
	for (const [type, headers, key] of cases) {
		it(`${type}: [${headers.slice(0, 3).join(', ')}, ...] is '${key}' (whatever the title)`, () => {
			const s = session([staticView(headers, [[1]], { name: 'Renamed by hand' })], type);
			const { plot, warning } = migrateDataViewPlot(s.plots[0], s);
			expect(warning).toBeNull();
			expect(plot.type).toBe('tableplot');
			expect(plot.sourceNodeId).toBe('tableprocess_9');
			expect(plot.plot).toEqual({
				source: 'node',
				resultKey: key,
				snapshot: { headers, rows: [[1]] },
				...tableBase(3)
			});
		});
	}

	it('headers a node does not publish are not guessed (permutations on GroupComparison)', () => {
		const s = session([staticView(PERM, [], { name: 'x' })], 'GroupComparison');
		const { plot, warning } = migrateDataViewPlot(s.plots[0], s);
		expect(plot.plot.resultKey).toBeNull();
		expect(warning).toContain('its columns do not match');
	});

	it('falls back to the default title when the headers say nothing', () => {
		const s = session(
			[staticView(['a', 'b'], [[1, 2]], { name: 'Group summary' })],
			'GroupComparison'
		);
		expect(migrateDataViewPlot(s.plots[0], s).plot.plot.resultKey).toBe('summary');
	});

	it('unknown headers and title: a frozen snapshot, with one warning naming the table', () => {
		const s = session([staticView(['a', 'b'], [[1, 2]], { name: 'My numbers' })]);
		const { plot, warning } = migrateDataViewPlot(s.plots[0], s);
		expect(plot.plot).toEqual({
			source: 'node',
			resultKey: null,
			snapshot: { headers: ['a', 'b'], rows: [[1, 2]] },
			...tableBase(3)
		});
		expect(plot.sourceNodeId).toBe('tableprocess_9');
		expect(warning).toBe(
			"Data View 'My numbers' is now a Table showing the rows it had when saved; it no longer updates, because its columns do not match any table that node publishes"
		);
	});

	it('no sourceNodeId (sessions before the placement fix): frozen, warned', () => {
		const s = session([staticView(['column', 'r2'], [[1]], { sourceNodeId: null })]);
		const { plot, warning } = migrateDataViewPlot(s.plots[0], s);
		expect(plot.plot.resultKey).toBeNull();
		expect(plot.plot.snapshot.rows).toEqual([[1]]);
		expect(warning).toContain('it does not record which node it came from');
	});

	it('a source node that is not in the file: frozen, warned, link kept', () => {
		const s = session([staticView(['column', 'r2'], [[1]], { sourceNodeId: 'tableprocess_404' })]);
		const { plot, warning } = migrateDataViewPlot(s.plots[0], s);
		expect(plot.plot.resultKey).toBeNull();
		expect(plot.sourceNodeId).toBe('tableprocess_404');
		expect(warning).toContain('no longer in the session');
	});

	it('a view with no saved rows gets no snapshot', () => {
		const s = session([staticView([], [], { name: 'Cosinor stats' })]);
		const { plot } = migrateDataViewPlot(s.plots[0], s);
		expect(plot.plot.resultKey).toBe('stats');
		expect(plot.plot.snapshot).toBeNull();
	});

	it('migrateDataViews reports one warning per frozen table, in file order', () => {
		const s = session([
			staticView(['a'], [], { id: 1, name: 'one' }),
			staticView(['column'], [], { id: 2, name: 'two' }),
			staticView(['b'], [], { id: 3, name: 'three' })
		]);
		const { warnings } = migrateDataViews(s);
		expect(warnings).toHaveLength(2);
		expect(warnings[0]).toContain("'one'");
		expect(warnings[1]).toContain("'three'");
	});
});

describe('NODE_RESULT_TABLES matches what the nodes publish', () => {
	// The migration cannot import the node components (it runs before anything is built), so
	// its copy of each node's published keys and titles is pinned to the components' source.
	for (const [type, tables] of Object.entries(NODE_RESULT_TABLES)) {
		it(type, () => {
			const src = readFileSync(
				join(process.cwd(), 'src', 'lib', 'tableProcesses', `${type}.svelte`),
				'utf8'
			);
			const call = src.slice(src.indexOf('useNodeResultTables(() =>'));
			const block = call.slice(0, call.indexOf('});'));
			for (const [key, { title }] of Object.entries(tables)) {
				if (key === 'permutations') {
					const label = title.replace(/: permutations$/, '');
					expect(block).toContain(`permutations: permutationResultTableSpec('${label}'`);
				} else {
					expect(block).toMatch(new RegExp(`${key}: \\{[\\s\\S]*?title: '${title}'`));
				}
			}
			const published = [...block.matchAll(/^\t\t(\w+): /gm)].map((m) => m[1]);
			expect(published.sort()).toEqual(Object.keys(tables).sort());
		});
	}
});
