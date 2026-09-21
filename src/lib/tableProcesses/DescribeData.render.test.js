// Mount tests for the Describe Data control panel.
//
// Two reported defects were pure MARKUP defects that no test of describedata()
// could see: the panel showed no input picker (every other analysis node lets
// you add/remove its wired columns from the panel), and the summary table
// wrapped its numbers one character per line in the 250px panel because only
// the name cell was nowrap. This mounts the component the way TableProcess.svelte
// and the canvas editor panel do.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { flushSync } from 'svelte';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: new Map(), data: [], groups: [], plots: [], tableProcesses: [] }
}));
vi.mock('$lib/core/core.svelte.js', () => ({
	core: { rawData: new Map(), data: [], groups: [], plots: [], tableProcesses: [] }
}));
vi.mock('$lib/core/Column.svelte', async () => {
	const actual = await vi.importActual('$lib/core/Column.svelte').catch(() => ({}));
	return { ...actual, getColumnById: (id) => mockColumns[id], default: actual.default };
});

const DescribeData = (await import('./DescribeData.svelte')).default;

function mkCol(id, name, data) {
	mockColumns[id] = { id, name, type: 'number', getData: () => data, getDataHash: String(data) };
	return id;
}

function mkProcess(over = {}) {
	return {
		id: 1,
		name: 'DescribeData',
		warnings: [],
		args: {
			yIN: [1, 2],
			out: {},
			valid: false,
			...over
		}
	};
}

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
	mkCol(1, 'Describe Data input 1', [10, 20, 30, 40, 50]);
	mkCol(2, 'Describe Data input 2', [1, 2, 3, 4, 5]);
});
afterEach(() => cleanup());

describe('DescribeData control panel', () => {
	it('renders the many-in column picker with its selection count', () => {
		const { container } = render(DescribeData, { props: { p: mkProcess() } });
		flushSync();
		expect(container.textContent).toMatch(/Columns to describe/);
		// The shared ColumnSelector trigger reports the selection, which is the
		// add/remove affordance every other analysis node exposes.
		expect(container.querySelector('.trigger')?.textContent).toMatch(/2 selected/);
	});

	it('hides the picker when the node is chained (hideInputs), like its siblings', () => {
		const { container } = render(DescribeData, {
			props: { p: mkProcess(), hideInputs: true }
		});
		flushSync();
		expect(container.textContent).not.toMatch(/Columns to describe/);
		expect(container.querySelector('.trigger')).toBeNull();
	});

	it('lays the summary out as one non-wrapping row per variable', () => {
		const { container } = render(DescribeData, { props: { p: mkProcess() } });
		flushSync();
		const rows = container.querySelectorAll('tbody tr');
		expect(rows.length).toBe(2);
		// jsdom does not apply Svelte's scoped styles, so assert the structure the
		// CSS hangs off: the table sits in the overflow-x scroll wrapper (so a
		// narrow panel scrolls sideways rather than splitting "48.43" across lines).
		expect(container.querySelector('.d-table-wrap > table.d-table')).not.toBeNull();
		// Numbers are right-aligned via the .num class, names via .var.
		const first = rows[0].querySelectorAll('td');
		expect(first[0].classList.contains('var')).toBe(true);
		for (let i = 1; i < first.length; i++) expect(first[i].classList.contains('num')).toBe(true);
	});

	it('prints n as a whole number and other stats to four significant figures', () => {
		mkCol(1, 'a', [1, 2, 3, 4, 5, 6, 7]); // mean 4, sd 2.1602468995
		const { container } = render(DescribeData, { props: { p: mkProcess({ yIN: [1] }) } });
		flushSync();
		const cells = [...container.querySelectorAll('tbody tr')[0].querySelectorAll('td')].map((c) =>
			c.textContent.trim()
		);
		// [var, n, mean, median, sd, min, max]
		expect(cells[1]).toBe('7');
		expect(cells[2]).toBe('4');
		expect(cells[4]).toBe('2.16');
		expect(cells[1]).not.toMatch(/\./);
	});
});
