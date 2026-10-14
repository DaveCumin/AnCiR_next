import { describe, it, expect } from 'vitest';
import {
	tableSourceOf,
	tableTakesColumns,
	isNodeResultsTable,
	isPlotDataTable,
	normaliseTableSource,
	normaliseRowTable
} from './tableSource.js';

describe('tableSourceOf', () => {
	it('defaults to columns when absent, unknown or the inner is missing', () => {
		expect(tableSourceOf({})).toBe('columns');
		expect(tableSourceOf({ source: 'nonsense' })).toBe('columns');
		expect(tableSourceOf(null)).toBe('columns');
		expect(tableSourceOf(undefined)).toBe('columns');
	});
	it('keeps the two other modes', () => {
		expect(tableSourceOf({ source: 'plot' })).toBe('plot');
		expect(tableSourceOf({ source: 'node' })).toBe('node');
	});
});

describe('tableTakesColumns and the mode predicates', () => {
	const t = (source) => ({ type: 'tableplot', plot: source ? { source } : {} });
	it('only a Columns-mode Table takes columns', () => {
		expect(tableTakesColumns(t())).toBe(true);
		expect(tableTakesColumns(t('columns'))).toBe(true);
		expect(tableTakesColumns(t('plot'))).toBe(false);
		expect(tableTakesColumns(t('node'))).toBe(false);
	});
	it('is false for any plot that is not a Table', () => {
		expect(tableTakesColumns({ type: 'scatterplot', plot: {} })).toBe(false);
		expect(tableTakesColumns(null)).toBe(false);
	});
	it('isNodeResultsTable / isPlotDataTable pick out their own mode only', () => {
		expect(isNodeResultsTable(t('node'))).toBe(true);
		expect(isNodeResultsTable(t('plot'))).toBe(false);
		expect(isNodeResultsTable(t())).toBe(false);
		expect(isNodeResultsTable({ type: 'scatterplot', plot: { source: 'node' } })).toBe(false);
		expect(isPlotDataTable(t('plot'))).toBe(true);
		expect(isPlotDataTable(t('node'))).toBe(false);
	});
});

describe('normaliseTableSource', () => {
	it('an old Columns Table (no source fields) normalises to the empty columns source', () => {
		expect(normaliseTableSource({ columnRefs: [1] })).toEqual({
			source: 'columns',
			sourcePlotId: null,
			resultKey: null,
			snapshot: null
		});
	});
	it('keeps a numeric or panel-id source plot and a result key', () => {
		expect(normaliseTableSource({ source: 'plot', sourcePlotId: 7 }).sourcePlotId).toBe(7);
		expect(normaliseTableSource({ source: 'plot', sourcePlotId: '7:c112#0' }).sourcePlotId).toBe(
			'7:c112#0'
		);
		expect(normaliseTableSource({ source: 'node', resultKey: 'stats' }).resultKey).toBe('stats');
	});
	it('drops wrong shapes rather than throwing', () => {
		const n = normaliseTableSource({
			source: 'node',
			sourcePlotId: { x: 1 },
			resultKey: 3,
			snapshot: { headers: 'a', rows: [] }
		});
		expect(n).toEqual({ source: 'node', sourcePlotId: null, resultKey: null, snapshot: null });
	});
	it('keeps a valid snapshot (rows default to [])', () => {
		expect(normaliseTableSource({ source: 'node', snapshot: { headers: ['a'] } }).snapshot).toEqual(
			{ headers: ['a'], rows: [] }
		);
	});
});

describe('normaliseRowTable', () => {
	it('needs at least one header', () => {
		expect(normaliseRowTable({ headers: [], rows: [[1]] })).toBeNull();
		expect(normaliseRowTable(null)).toBeNull();
		expect(normaliseRowTable({ headers: ['a'], rows: [[1]] })).toEqual({
			headers: ['a'],
			rows: [[1]]
		});
	});
});
