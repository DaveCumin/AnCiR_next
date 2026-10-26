// STAT-36: Describe Data gained sem, ciLow and ciHigh. A session saved before then has no column
// for them, and the TableProcess constructor only seeds out keys for a NEW node, so the
// component creates the missing ones on mount (and never touches the old ones: their wires
// anchor on col_<id>).
/* global $state */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync, tick } from 'svelte';

const { mockColumns, tableProcesses, coreMock } = vi.hoisted(() => {
	const mockColumns = {};
	const tableProcesses = [];
	const coreMock = () => ({
		core: { rawData: new Map(), data: [], groups: [], plots: [], tableProcesses },
		pushObj: (obj) => {
			mockColumns[obj.id] = obj;
		}
	});
	return { mockColumns, tableProcesses, coreMock };
});
vi.mock('$lib/core/core.svelte', coreMock);
vi.mock('$lib/core/core.svelte.js', coreMock);
vi.mock('$lib/core/Column.svelte', async () => {
	let nextId = 500;
	return {
		getColumnById: (id) => mockColumns[id],
		removeColumn: (id) => delete mockColumns[id],
		Column: class {
			constructor() {
				this.id = nextId++;
				this.name = '';
				this.type = 'number';
			}
		}
	};
});
vi.mock('$lib/tableProcesses/outputColumns.js', () => ({
	writeOutputColumn: (id, values) => {
		if (id != null && id >= 0 && mockColumns[id]) mockColumns[id].written = values;
	}
}));

const DescribeData = (await import('./DescribeData.svelte')).default;
const { memoClear } = await import('$lib/core/computeMemo.js');

afterEach(() => cleanup());

const OLD_KEYS = ['variable', 'n', 'mean', 'median', 'sd', 'min', 'max', 'range', 'q1', 'q3'];
const OLD_KEYS_ALL = [...OLD_KEYS, 'iqr', 'skewness', 'kurtosis'];

describe('Describe Data on a session saved before SEM and the CI existed', () => {
	it('creates sem, ciLow and ciHigh columns, fills them, and keeps the old ids', async () => {
		memoClear();
		mockColumns[1] = {
			id: 1,
			name: 'a',
			type: 'number',
			getData: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
			getDataHash: 'h1'
		};
		const out = {};
		OLD_KEYS_ALL.forEach((k, i) => {
			out[k] = 100 + i;
			mockColumns[100 + i] = { id: 100 + i, name: `${k}_7`, type: 'number' };
		});
		const p = $state({ id: 7, name: 'DescribeData', warnings: [], args: { yIN: [1], out } });
		tableProcesses.push({ id: 7 });
		render(DescribeData, { props: { p, hideInputs: true } });
		flushSync();
		await tick();

		OLD_KEYS_ALL.forEach((k, i) => expect(p.args.out[k]).toBe(100 + i));
		for (const k of ['sem', 'ciLow', 'ciHigh']) {
			expect(p.args.out[k]).toBeGreaterThanOrEqual(500);
			expect(mockColumns[p.args.out[k]].name).toBe(`${k}_7`);
		}
		// scipy.stats.sem(1..10) and t.interval(0.95, 9, 5.5, sem).
		expect(mockColumns[p.args.out.sem].written[0]).toBeCloseTo(0.9574271077563381, 12);
		expect(mockColumns[p.args.out.ciLow].written[0]).toBeCloseTo(3.334149410331831, 10);
		expect(mockColumns[p.args.out.ciHigh].written[0]).toBeCloseTo(7.665850589668169, 10);
	});
});
