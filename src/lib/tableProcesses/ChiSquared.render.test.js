// Mount test for the contingency-table render.
//
// The reported crash was a RENDER error, not a maths error: Svelte's
// `validate_each_keys` threw `each_key_duplicate ... key '0_2'` because the
// inner each keyed on the cell VALUE plus the row index, so two equal counts in
// one row collided. No pure-function test could have caught it — the func
// returned a perfectly good table. This mounts the component so the keyed each
// actually runs.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';

const mockColumns = {};
vi.mock('$lib/core/core.svelte', () => ({
	core: { rawData: new Map(), data: [], tableProcesses: [] }
}));
vi.mock('$lib/core/Column.svelte', async () => {
	const actual = await vi.importActual('$lib/core/Column.svelte').catch(() => ({}));
	return { ...actual, getColumnById: (id) => mockColumns[id], default: actual.default };
});

const ChiSquared = (await import('./ChiSquared.svelte')).default;

function mkCol(id, name, data) {
	mockColumns[id] = { id, name, type: 'category', getData: () => data, getDataHash: String(data) };
	return id;
}

function mkProcess(over = {}) {
	return {
		id: 1,
		name: 'ChiSquared',
		warnings: [],
		args: {
			testType: 'independence',
			xIN: 1,
			yIN: 2,
			correction: true,
			alternative: 'two-sided',
			out: { statistic: -1, pvalue: -1, df: -1 },
			valid: false,
			...over
		}
	};
}

beforeEach(() => {
	Object.keys(mockColumns).forEach((k) => delete mockColumns[k]);
});
afterEach(() => cleanup());

describe('ChiSquared contingency table renders without duplicate keys', () => {
	it('renders a 3x3 table whose row contains repeated counts', () => {
		// This is the exact shape that crashed: the third row is [0, 0, n], so the
		// old key (cell value + row index) produced '0_2' twice.
		mkCol(1, 'group', ['a', 'b', 'a', 'b', 'a', 'b', 'c', 'c', 'c']);
		mkCol(2, 'outcome', ['x', 'x', 'x', 'y', 'y', 'y', 'z', 'z', 'z']);
		expect(() => render(ChiSquared, { props: { p: mkProcess() } })).not.toThrow();
	});

	it('renders a table that is entirely zeros in one row', () => {
		mkCol(1, 'group', ['a', 'a', 'b', 'b', 'c', 'c']);
		mkCol(2, 'outcome', ['x', 'x', 'x', 'x', 'y', 'y']);
		expect(() => render(ChiSquared, { props: { p: mkProcess() } })).not.toThrow();
	});

	it('renders the NaN-padded data from the bug report', () => {
		mkCol(1, 'group', ['a', 'b', 'a', 'b', 'a', 'b', NaN, NaN, NaN]);
		mkCol(2, 'outcome', ['a', 'a', 'a', 'b', 'b', 'b', NaN, NaN, NaN]);
		const { container } = render(ChiSquared, { props: { p: mkProcess() } });
		// 2x2 after the NaN fix: header row + 2 body rows.
		const rows = container.querySelectorAll('tbody tr');
		expect(rows.length).toBe(2);
	});

	it('renders in Fisher mode too', () => {
		mkCol(1, 'group', ['a', 'b', 'a', 'b', 'a', 'b', NaN]);
		mkCol(2, 'outcome', ['a', 'a', 'a', 'b', 'b', 'b', NaN]);
		expect(() =>
			render(ChiSquared, { props: { p: mkProcess({ testType: 'fisher' }) } })
		).not.toThrow();
	});
});
